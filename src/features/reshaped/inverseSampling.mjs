export const ADAPTIVE_MAX_DEPTH = 8;
export const INVERSE_TEXTURE_WIDTH = 1024;
export const ADAPTIVE_LEAF_BIT = 0x80000000;
export const ADAPTIVE_LEAF_MASK = 0x7fffffff;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = (value, period) => ((value % period) + period) % period;
export const wrapDisplacementLongitude = (value) =>
  wrap(value + 180, 360) - 180;
export const equalAreaToLatitudeCoordinate = (y) =>
  Math.asin(clamp(2 * y - 1, -1, 1)) / Math.PI + 0.5;
export const latitudeCoordinateToEqualArea = (y) =>
  (Math.sin((y - 0.5) * Math.PI) + 1) / 2;
const latitudeField = (field) =>
  field?.header?.verticalCoordinate === 'latitude';

/** Node-aligned roots, quadrants ordered (00, 10, 01, 11), pole endpoints.
 * The WebGL2 sampler uses these exact coordinate and seam conventions. */
export function locateAdaptiveLeaf(field, x, y) {
  return locateAdaptiveLeafAtDomain(
    field,
    x,
    latitudeField(field) ? equalAreaToLatitudeCoordinate(y) : y,
  );
}

export function locateAdaptiveLeafAtDomain(field, x, y) {
  const sx = wrap(x, 1) * field.width;
  const sy = clamp(y, 0, 1) * field.height;
  const col = Math.min(field.width - 1, Math.floor(sx));
  const row = Math.min(field.height - 1, Math.floor(sy));
  let fx = sx - col,
    fy = sy - row;
  let node = row * field.width + col;
  for (let depth = 0; depth <= ADAPTIVE_MAX_DEPTH; depth += 1) {
    const word = field.tree[node];
    if ((word & ADAPTIVE_LEAF_BIT) !== 0)
      return { node, leaf: word & ADAPTIVE_LEAF_MASK, fx, fy };
    const qx = Math.min(1, Math.floor(fx * 2));
    const qy = Math.min(1, Math.floor(fy * 2));
    node = word + qy * 2 + qx;
    fx = fx * 2 - qx;
    fy = fy * 2 - qy;
  }
  throw new Error('Cartogram tree exceeds the supported depth');
}

function sampleEncodedDisplacement(field, x, y) {
  if (!field) return [0, 0];
  let indices,
    weights,
    values,
    longitudeStep = 1,
    sStep = 1;
  if (field.encoding === 'adaptive-quadtree-int16') {
    const { leaf, fx, fy } = locateAdaptiveLeaf(field, x, y);
    const at = leaf * 8;
    indices = [at, at + 2, at + 4, at + 6];
    weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    values = field.corners;
    longitudeStep = field.header.stepLongitude;
    sStep = latitudeField(field)
      ? field.header.stepLatitude
      : field.header.stepS;
  } else {
    const { width, height, data } = field;
    const fx = wrap(x, 1) * width - 0.5;
    const fy = clamp(y * height - 0.5, 0, height - 1);
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy),
      tx = fx - x0,
      ty = fy - y0;
    indices = [
      (y0 * width + wrap(x0, width)) * 2,
      (y0 * width + wrap(x0 + 1, width)) * 2,
      (Math.min(height - 1, y0 + 1) * width + wrap(x0, width)) * 2,
      (Math.min(height - 1, y0 + 1) * width + wrap(x0 + 1, width)) * 2,
    ];
    weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    values = data;
  }
  const base = values[indices[0]] * longitudeStep;
  let longitude = 0,
    s = 0;
  for (let i = 0; i < 4; i += 1) {
    longitude +=
      (base +
        wrapDisplacementLongitude(values[indices[i]] * longitudeStep - base)) *
      weights[i];
    s += values[indices[i] + 1] * sStep * weights[i];
  }
  if (field.encoding !== 'adaptive-quadtree-int16')
    s *= clamp(2 * Math.min(y, 1 - y) * field.height, 0, 1);
  return [longitude, s === 0 ? 0 : s];
}

export function sampleInverseLatitude(field, x, latitude) {
  if (!field)
    return [
      x,
      (Math.asin(Math.sin((latitude * Math.PI) / 180)) * 180) / Math.PI,
    ];
  const y = (Math.sin((latitude * Math.PI) / 180) + 1) / 2;
  const [longitude, vertical] = sampleEncodedDisplacement(field, x, y);
  const sourceLatitude = latitudeField(field)
    ? clamp(latitude + vertical, -90, 90)
    : (Math.asin(clamp(2 * y - 1 + vertical, -1, 1)) * 180) / Math.PI;
  return [x + longitude / 360, sourceLatitude];
}

export function sampleInverseDisplacement(field, x, y) {
  const [longitude, vertical] = sampleEncodedDisplacement(field, x, y);
  if (!latitudeField(field) || vertical === 0) return [longitude, vertical];
  const latitude = Math.asin(clamp(2 * y - 1, -1, 1));
  return [
    longitude,
    Math.sin(
      clamp(latitude + (vertical * Math.PI) / 180, -Math.PI / 2, Math.PI / 2),
    ) -
      (2 * y - 1),
  ];
}

export function sampleInverseCoordinates(field, x, y) {
  const [longitude, vertical] = sampleEncodedDisplacement(field, x, y);
  if (latitudeField(field)) {
    if (vertical === 0) return [x + longitude / 360, y];
    const latitude =
      Math.asin(clamp(2 * y - 1, -1, 1)) + (vertical * Math.PI) / 180;
    return [
      x + longitude / 360,
      (Math.sin(clamp(latitude, -Math.PI / 2, Math.PI / 2)) + 1) / 2,
    ];
  }
  return [x + longitude / 360, clamp(y + vertical / 2, 0, 1)];
}

/** Preserve the planned sin(latitude) morph without subtracting near-pole floats. */
export function morphLatitude(from, to, t) {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const a = (from * Math.PI) / 180,
    b = (to * Math.PI) / 180;
  const north = (1 - t) * Math.sin(a) + t * Math.sin(b) >= 0;
  const pole = north ? Math.PI / 2 : -Math.PI / 2;
  const distance = Math.sqrt(
    (1 - t) * Math.sin((pole - a) / 2) ** 2 + t * Math.sin((pole - b) / 2) ** 2,
  );
  return (
    ((pole + (north ? -2 : 2) * Math.asin(clamp(distance, 0, 1))) * 180) /
    Math.PI
  );
}

/** Both fields coexist during a morph. Includes padding to shader texture rows. */
export function inverseTextureBytes(field) {
  if (field.encoding !== 'adaptive-quadtree-int16')
    return field.width * field.height * 8 + 20;
  const tree =
    Math.ceil(field.tree.length / INVERSE_TEXTURE_WIDTH) *
    INVERSE_TEXTURE_WIDTH *
    4;
  const corners =
    Math.ceil(field.corners.length / (INVERSE_TEXTURE_WIDTH * 4)) *
    INVERSE_TEXTURE_WIDTH *
    8;
  return tree + corners + 8;
}

export function inverseTextureBytesFromDescriptor(field) {
  if (field.encoding !== 'adaptive-quadtree-int16')
    return field.width * field.height * 8 + 20;
  return (
    Math.ceil(field.treeNodes / INVERSE_TEXTURE_WIDTH) *
      INVERSE_TEXTURE_WIDTH *
      4 +
    Math.ceil((field.leafCount * 2) / INVERSE_TEXTURE_WIDTH) *
      INVERSE_TEXTURE_WIDTH *
      8 +
    8
  );
}

export function reshapedMorphTextureBytes(
  fromBytes,
  toBytes,
  maxRasterId,
  width = 4096,
  height = 2048,
) {
  const paletteBytes = Math.ceil((maxRasterId + 1) / 256) * 256 * 16;
  return fromBytes + toBytes + width * height * 2 + paletteBytes;
}

export function adaptiveLeafLayout(field) {
  const factor = 2 ** field.header.maxDepth;
  const bounds = new Array(field.tree.length),
    leaves = [];
  for (let y = 0; y < field.height; y += 1)
    for (let x = 0; x < field.width; x += 1)
      bounds[y * field.width + x] = [x * factor, y * factor, factor, 0];
  for (let node = 0; node < field.tree.length; node += 1) {
    const [x, y, size, depth] = bounds[node];
    const word = field.tree[node];
    if ((word & ADAPTIVE_LEAF_BIT) !== 0) {
      leaves.push(node);
      continue;
    }
    const half = size / 2;
    for (let q = 0; q < 4; q += 1)
      bounds[word + q] = [
        x + (q % 2) * half,
        y + Math.floor(q / 2) * half,
        half,
        depth + 1,
      ];
  }
  return {
    bounds,
    leaves,
    latticeWidth: field.width * factor,
    latticeHeight: field.height * factor,
  };
}

export function sampleAdaptiveLeafCoordinates(field, node, x, y, layout) {
  const [ix, iy, size] = layout.bounds[node];
  let px = wrap(x, 1) * layout.latticeWidth;
  px +=
    Math.round((ix + size / 2 - px) / layout.latticeWidth) *
    layout.latticeWidth;
  const domainY = latitudeField(field) ? equalAreaToLatitudeCoordinate(y) : y;
  const fx = (px - ix) / size,
    fy = (domainY * layout.latticeHeight - iy) / size;
  const at = (field.tree[node] & ADAPTIVE_LEAF_MASK) * 8;
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const base = field.corners[at] * field.header.stepLongitude;
  let longitude = 0,
    ds = 0;
  for (let q = 0; q < 4; q += 1) {
    longitude +=
      (base +
        wrapDisplacementLongitude(
          field.corners[at + q * 2] * field.header.stepLongitude - base,
        )) *
      weights[q];
    ds +=
      field.corners[at + q * 2 + 1] *
      (latitudeField(field) ? field.header.stepLatitude : field.header.stepS) *
      weights[q];
  }
  return [
    x + longitude / 360,
    latitudeField(field)
      ? ds === 0
        ? y
        : latitudeCoordinateToEqualArea(clamp(domainY + ds / 180, 0, 1))
      : clamp(y + ds / 2, 0, 1),
  ];
}

export function measureAdaptiveEdgeContinuity(field) {
  if (field.encoding !== 'adaptive-quadtree-int16')
    return {
      balanced: true,
      maximumDepthDifference: 0,
      maxDegrees: 0,
      edgesChecked: 0,
    };
  const layout = adaptiveLeafLayout(field);
  let maximumDepthDifference = 0,
    maxDegrees = 0,
    edgesChecked = 0;
  const distance = (a, b) => {
    const la = Math.asin(clamp(a[1] * 2 - 1, -1, 1)),
      lb = Math.asin(clamp(b[1] * 2 - 1, -1, 1));
    const longitude =
      (wrapDisplacementLongitude((a[0] - b[0]) * 360) * Math.PI) / 180;
    const h =
      Math.sin((la - lb) / 2) ** 2 +
      Math.cos(la) * Math.cos(lb) * Math.sin(longitude / 2) ** 2;
    return (360 / Math.PI) * Math.asin(Math.sqrt(clamp(h, 0, 1)));
  };
  for (const node of layout.leaves) {
    const [ix, iy, size, depth] = layout.bounds[node];
    for (let edge = 0; edge < 4; edge += 1) {
      if (
        (edge === 2 && iy === 0) ||
        (edge === 3 && iy + size === layout.latticeHeight)
      )
        continue;
      const vertical = edge < 2;
      const x = ix + (vertical ? edge * size : size / 2);
      const y = iy + (vertical ? size / 2 : (edge - 2) * size);
      const nx = x + (vertical ? (edge === 0 ? -0.25 : 0.25) : 0);
      const ny = y + (vertical ? 0 : edge === 2 ? -0.25 : 0.25);
      const neighbour = locateAdaptiveLeafAtDomain(
        field,
        nx / layout.latticeWidth,
        ny / layout.latticeHeight,
      ).node;
      maximumDepthDifference = Math.max(
        maximumDepthDifference,
        Math.abs(depth - layout.bounds[neighbour][3]),
      );
      // Fine edges cover every coarse-edge segment; endpoints and interior
      // probes compare both one-sided bilinear limits without epsilon drift.
      if (layout.bounds[neighbour][2] < size) continue;
      edgesChecked += 1;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const px = (vertical ? x : ix + t * size) / layout.latticeWidth;
        const domainY = (vertical ? iy + t * size : y) / layout.latticeHeight;
        const py = latitudeField(field)
          ? latitudeCoordinateToEqualArea(domainY)
          : domainY;
        maxDegrees = Math.max(
          maxDegrees,
          distance(
            sampleAdaptiveLeafCoordinates(field, node, px, py, layout),
            sampleAdaptiveLeafCoordinates(field, neighbour, px, py, layout),
          ),
        );
      }
    }
  }
  return {
    balanced: maximumDepthDifference <= 1,
    maximumDepthDifference,
    maxDegrees,
    edgesChecked,
  };
}
