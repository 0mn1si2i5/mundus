import { MeshoptEncoder } from 'meshoptimizer/encoder';
import {
  rasterizeInverseMap,
  sampleInverseRaster,
  measureRoundTrip,
} from './cartogram.mjs';
import { decodeInverse } from '../../src/features/reshaped/inverseFormat.mjs';
import { createRobustTriangleInverse } from './triangle-inverse.mjs';
import {
  ADAPTIVE_LEAF_BIT,
  ADAPTIVE_MAX_DEPTH,
  locateAdaptiveLeaf,
  locateAdaptiveLeafAtDomain,
  equalAreaToLatitudeCoordinate,
  latitudeCoordinateToEqualArea,
  sampleInverseCoordinates,
  inverseTextureBytes,
  measureAdaptiveEdgeContinuity,
} from '../../src/features/reshaped/inverseSampling.mjs';

const wrap = (x) => x - Math.floor(x + 0.5);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function angularErrorDegrees(a, b) {
  const lon = wrap(a[0] - b[0]) * 2 * Math.PI;
  const la = Math.asin(clamp(2 * a[1] - 1, -1, 1));
  const lb = Math.asin(clamp(2 * b[1] - 1, -1, 1));
  const h =
    Math.sin((la - lb) / 2) ** 2 +
    Math.cos(la) * Math.cos(lb) * Math.sin(lon / 2) ** 2;
  return (360 / Math.PI) * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

/** The browser's periodic bilinear sampler, in normalized equal-area coordinates. */
export function sampleEncodedInverse(field, x, y) {
  return sampleInverseCoordinates(field, x, y);
}

export async function encodeRegularInverseField(map, { metric, level }) {
  const width = level === 'country' ? 512 : 1024,
    height = width / 2;
  const raster = rasterizeInverseMap(map, { width, height, centers: true });
  const count = width * height;
  let maxLongitude = 0,
    maxS = 0;
  const displacements = new Float64Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const x = ((i % width) + 0.5) / width,
      y = (Math.floor(i / width) + 0.5) / height;
    const lon = wrap(raster.grid[i * 2] - x) * 360;
    const ds = (raster.grid[i * 2 + 1] - y) * 2;
    displacements[i * 2] = lon;
    displacements[i * 2 + 1] = ds;
    maxLongitude = Math.max(maxLongitude, Math.abs(lon));
    maxS = Math.max(maxS, Math.abs(ds));
    // Retain the same branch of longitude for the raw acceptance sampler.
    raster.grid[i * 2] = x + lon / 360;
  }
  const stepLongitude = Math.max(maxLongitude / 32767, 1e-9);
  const stepS = Math.max(maxS / 32767, 1e-12);
  const quantized = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i += 1) {
    quantized.writeInt16LE(
      Math.round(displacements[i * 2] / stepLongitude),
      i * 4,
    );
    quantized.writeInt16LE(
      Math.round(displacements[i * 2 + 1] / stepS),
      i * 4 + 2,
    );
  }
  await MeshoptEncoder.ready;
  const encoded = MeshoptEncoder.encodeVertexBuffer(quantized, count, 4);
  const header = {
    formatVersion: 1,
    width,
    height,
    stepLongitude,
    stepS,
    metric,
    level,
    stride: 4,
    encodedBytes: encoded.length,
  };
  const json = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.alloc(8);
  prefix.write('MRE1');
  prefix.writeUInt32LE(json.length, 4);
  const bytes = Buffer.concat([prefix, json, encoded]);
  const decoded = await decodeInverse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { metric, level },
  );
  const sampler = (x, y) => sampleEncodedInverse(decoded, x, y);
  let quantizationMaxDegrees = 0;
  for (let y = 0; y <= map.height; y += 1)
    for (let x = 0; x <= map.width; x += 1) {
      const at = map.forward(x / map.width, y / map.height);
      quantizationMaxDegrees = Math.max(
        quantizationMaxDegrees,
        angularErrorDegrees(sampleInverseRaster(raster, ...at), sampler(...at)),
      );
    }
  for (let i = 0; i < count; i += 1) {
    const x = ((i % width) + 0.5) / width,
      y = (Math.floor(i / width) + 0.5) / height;
    quantizationMaxDegrees = Math.max(
      quantizationMaxDegrees,
      angularErrorDegrees(sampleInverseRaster(raster, x, y), sampler(x, y)),
    );
  }
  return {
    bytes,
    header,
    roundTrip: measureRoundTrip(map, sampler),
    quantizationMaxDegrees,
  };
}

const PROBES = [
  [0.5, 0.5],
  [0.5, 0],
  [0.5, 1],
  [0, 0.5],
  [1, 0.5],
];

/** Fit the triangle inverse locally, then refine failing ALL-source-node checks.
 * The transmitted tree and four-corner leaves are consumed unchanged by CPU
 * and GLSL; no runtime triangulation, Newton field reconstruction or dependency.
 */
export async function encodeAdaptiveInverseField(
  map,
  {
    metric,
    level,
    rootWidth = 128,
    rootHeight = rootWidth / 2,
    maxDepth = ADAPTIVE_MAX_DEPTH,
    toleranceDegrees = 0.025,
    onProgress,
  } = {},
) {
  const power = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
  if (
    !power(rootWidth) ||
    !power(rootHeight) ||
    rootWidth > 1024 ||
    rootHeight > 512 ||
    !Number.isInteger(maxDepth) ||
    maxDepth < 0 ||
    maxDepth > ADAPTIVE_MAX_DEPTH ||
    !Number.isFinite(toleranceDegrees) ||
    toleranceDegrees <= 0
  )
    throw new RangeError('Invalid adaptive inverse settings');
  const latticeWidth = rootWidth * 2 ** maxDepth;
  const latticeHeight = rootHeight * 2 ** maxDepth;
  const roots = rootWidth * rootHeight;
  const tree = new Array(roots).fill(0);
  const corners = new Array(roots * 8).fill(0);
  const bounds = new Array(roots);
  const samples = new Map();
  const exactInverse = createRobustTriangleInverse(map, { onProgress });
  let refined = 0,
    saturated = 0;
  function displacement(ix, iy) {
    const col = ((ix % latticeWidth) + latticeWidth) % latticeWidth;
    const key = iy * latticeWidth + col;
    let value = samples.get(key);
    if (!value) {
      const x = col / latticeWidth,
        domainY = iy / latticeHeight,
        y = latitudeCoordinateToEqualArea(domainY);
      const point = exactInverse(x, y);
      if (!point.every(Number.isFinite))
        throw new Error('Non-finite triangle inverse');
      value = [
        wrap(point[0] - x) * 360,
        iy === 0 || iy === latticeHeight || point[1] === y
          ? 0
          : (equalAreaToLatitudeCoordinate(point[1]) - domainY) * 180,
      ];
      samples.set(key, value);
    }
    return value;
  }
  function initialize(node, ix, iy, size, depth) {
    bounds[node] = [ix, iy, size, depth];
    tree[node] = (ADAPTIVE_LEAF_BIT | node) >>> 0;
    for (let q = 0; q < 4; q += 1) {
      const value = displacement(
        ix + (q % 2) * size,
        iy + Math.floor(q / 2) * size,
      );
      corners[node * 8 + q * 2] = value[0];
      corners[node * 8 + q * 2 + 1] = value[1];
    }
  }
  const raw = {
    width: rootWidth,
    height: rootHeight,
    encoding: 'adaptive-quadtree-int16',
    tree,
    corners,
    header: {
      verticalCoordinate: 'latitude',
      stepLongitude: 1,
      stepLatitude: 1,
    },
  };
  function split(node, recursive) {
    const [ix, iy, size, depth] = bounds[node];
    if (depth === maxDepth) {
      saturated += 1;
      return false;
    }
    // Only current leaves are split; internal corner storage is discarded later.
    if ((tree[node] & ADAPTIVE_LEAF_BIT) === 0) return false;
    const first = tree.length,
      half = size / 2;
    if (first + 4 > 900_000)
      throw new Error('Adaptive inverse exceeded its bounded tree allocation');
    tree[node] = first;
    refined += 1;
    for (let q = 0; q < 4; q += 1)
      initialize(
        first + q,
        ix + (q % 2) * half,
        iy + Math.floor(q / 2) * half,
        half,
        depth + 1,
      );
    if (recursive) for (let q = 0; q < 4; q += 1) fit(first + q);
    return true;
  }
  function fit(node) {
    const [ix, iy, size, depth] = bounds[node];
    if (depth === maxDepth) return;
    for (const [fx, fy] of PROBES) {
      const cx = ix + fx * size,
        cy = iy + fy * size;
      const x = cx / latticeWidth,
        domainY = cy / latticeHeight,
        y = latitudeCoordinateToEqualArea(domainY);
      const exact = displacement(cx, cy);
      // Sample this leaf directly; boundary probes must not select its neighbour.
      const at = node * 8,
        base = corners[at];
      const weights = [
        (1 - fx) * (1 - fy),
        fx * (1 - fy),
        (1 - fx) * fy,
        fx * fy,
      ];
      let dx = 0,
        ds = 0;
      for (let q = 0; q < 4; q += 1) {
        dx +=
          (base + wrap((corners[at + q * 2] - base) / 360) * 360) * weights[q];
        ds += corners[at + q * 2 + 1] * weights[q];
      }
      if (
        angularErrorDegrees(
          [
            x + exact[0] / 360,
            latitudeCoordinateToEqualArea(
              clamp(domainY + exact[1] / 180, 0, 1),
            ),
          ],
          [
            x + dx / 360,
            latitudeCoordinateToEqualArea(clamp(domainY + ds / 180, 0, 1)),
          ],
        ) > toleranceDegrees
      ) {
        split(node, true);
        return;
      }
    }
  }
  for (let y = 0; y < rootHeight; y += 1)
    for (let x = 0; x < rootWidth; x += 1)
      initialize(
        y * rootWidth + x,
        x * 2 ** maxDepth,
        y * 2 ** maxDepth,
        2 ** maxDepth,
        0,
      );
  for (let node = 0; node < roots; node += 1) {
    fit(node);
    if (node % 64 === 0)
      onProgress?.({
        phase: 'adaptive-inverse-fit',
        rootsVisited: node + 1,
        roots,
        nodes: tree.length,
        exactQueries: samples.size,
      });
  }
  const nodeCount = (map.width + 1) * (map.height + 1);
  let balanceRefinements = 0,
    hangingCorners = 0;
  let hangingOwners = new Map();
  const cornerKey = (x, y) =>
    y * latticeWidth + (((x % latticeWidth) + latticeWidth) % latticeWidth);
  function balance() {
    let changed;
    do {
      changed = false;
      for (let node = 0; node < tree.length; node += 1) {
        if ((tree[node] & ADAPTIVE_LEAF_BIT) === 0) continue;
        const [ix, iy, size, depth] = bounds[node];
        for (const [x, y] of [
          [ix - 0.25, iy + size / 2],
          [ix + size + 0.25, iy + size / 2],
          [ix + size / 2, iy - 0.25],
          [ix + size / 2, iy + size + 0.25],
        ]) {
          if (y < 0 || y > latticeHeight) continue;
          const neighbour = locateAdaptiveLeafAtDomain(
            raw,
            x / latticeWidth,
            y / latticeHeight,
          ).node;
          if (bounds[neighbour][3] < depth - 1 && split(neighbour, false)) {
            balanceRefinements += 1;
            changed = true;
          }
        }
        if (node % 4096 === 0)
          onProgress?.({
            phase: 'adaptive-balance',
            nodes: tree.length,
            balanceRefinements,
          });
      }
    } while (changed);
  }
  function constrainCorners() {
    const values = new Map(),
      relations = new Map();
    const key = cornerKey;
    for (let node = 0; node < tree.length; node += 1) {
      if ((tree[node] & ADAPTIVE_LEAF_BIT) === 0) continue;
      const [ix, iy, size] = bounds[node];
      for (let q = 0; q < 4; q += 1) {
        const x = ix + (q % 2) * size,
          y = iy + Math.floor(q / 2) * size;
        values.set(key(x, y), displacement(x, y));
      }
    }
    for (let node = 0; node < tree.length; node += 1) {
      if ((tree[node] & ADAPTIVE_LEAF_BIT) === 0) continue;
      const [ix, iy, size, depth] = bounds[node];
      for (let q = 0; q < 4; q += 1) {
        const x = ix + (q % 2) * size,
          y = iy + Math.floor(q / 2) * size,
          at = key(x, y);
        for (const dx of [-0.25, 0.25])
          for (const dy of [-0.25, 0.25]) {
            if (y + dy < 0 || y + dy > latticeHeight) continue;
            const neighbour = locateAdaptiveLeafAtDomain(
              raw,
              (x + dx) / latticeWidth,
              (y + dy) / latticeHeight,
            ).node;
            const [nx, ny, nsize, nd] = bounds[neighbour];
            if (nd >= depth) continue;
            const px =
              x +
              Math.round((nx + nsize / 2 - x) / latticeWidth) * latticeWidth;
            let a, b, t;
            if ((px === nx || px === nx + nsize) && y > ny && y < ny + nsize) {
              a = key(px, ny);
              b = key(px, ny + nsize);
              t = (y - ny) / nsize;
            } else if (
              (y === ny || y === ny + nsize) &&
              px > nx &&
              px < nx + nsize
            ) {
              a = key(nx, y);
              b = key(nx + nsize, y);
              t = (px - nx) / nsize;
            } else continue;
            const old = relations.get(at);
            if (!old || nd < old.depth)
              relations.set(at, { at, a, b, t, depth: nd, owner: neighbour });
          }
      }
      if (node % 4096 === 0)
        onProgress?.({ phase: 'adaptive-hanging-corners', nodes: tree.length });
    }
    for (const { at, a, b, t } of [...relations.values()].sort(
      (a, b) => a.depth - b.depth,
    )) {
      const first = values.get(a),
        second = values.get(b);
      if (!first || !second) throw new Error('Missing coarse edge endpoints');
      values.set(at, [
        first[0] + wrap((second[0] - first[0]) / 360) * 360 * t,
        first[1] + (second[1] - first[1]) * t,
      ]);
    }
    hangingCorners = relations.size;
    hangingOwners = relations;
    for (let node = 0; node < tree.length; node += 1) {
      if ((tree[node] & ADAPTIVE_LEAF_BIT) === 0) continue;
      const [ix, iy, size] = bounds[node];
      for (let q = 0; q < 4; q += 1) {
        const value = values.get(
          key(ix + (q % 2) * size, iy + Math.floor(q / 2) * size),
        );
        corners[node * 8 + q * 2] = value[0];
        corners[node * 8 + q * 2 + 1] = value[1];
      }
    }
  }
  function eachForward(callback) {
    for (let y = 0; y <= map.height; y += 1) {
      for (let x = 0; x <= map.width; x += 1) {
        const source = [x / map.width, y / map.height];
        const index = (y * (map.width + 1) + x) * 2;
        const at = map.forwardGrid
          ? [map.forwardGrid[index], map.forwardGrid[index + 1]]
          : map.forward(...source);
        callback(source, at);
      }
      if (y % 128 === 0)
        onProgress?.({
          phase: 'adaptive-inverse-check',
          row: y,
          rows: map.height + 1,
          nodes: tree.length,
        });
    }
  }
  let refinementPasses = 0;
  for (; refinementPasses <= maxDepth; refinementPasses += 1) {
    balance();
    constrainCorners();
    const failing = new Set();
    let maximum = 0;
    eachForward((source, at) => {
      const error = angularErrorDegrees(
        source,
        sampleInverseCoordinates(raw, ...at),
      );
      maximum = Math.max(maximum, error);
      if (error > toleranceDegrees) {
        const node = locateAdaptiveLeaf(raw, ...at).node;
        failing.add(node);
        // Refining only the fine leaf repeats the same erroneous coarse-edge
        // constraint. Refine the owner supplying that hanging corner as well.
        const [ix, iy, size] = bounds[node];
        const visit = (key) => {
          const relation = hangingOwners.get(key);
          if (!relation) return;
          failing.add(relation.owner);
          visit(relation.a);
          visit(relation.b);
        };
        for (let q = 0; q < 4; q += 1)
          visit(cornerKey(ix + (q % 2) * size, iy + Math.floor(q / 2) * size));
      }
    });
    onProgress?.({
      phase: 'adaptive-inverse',
      pass: refinementPasses,
      nodes: tree.length,
      failingLeaves: failing.size,
      maxDegrees: maximum,
    });
    let changed = false;
    for (const node of failing) changed = split(node, true) || changed;
    if (!changed) break;
  }
  balance();
  constrainCorners();
  const packedTree = new Uint32Array(tree.length),
    leaves = [];
  let maxLongitude = 0,
    maxLatitude = 0;
  for (let node = 0; node < tree.length; node += 1) {
    if ((tree[node] & ADAPTIVE_LEAF_BIT) === 0) {
      packedTree[node] = tree[node];
      continue;
    }
    packedTree[node] = (ADAPTIVE_LEAF_BIT | (leaves.length / 8)) >>> 0;
    for (let i = 0; i < 8; i += 1) {
      const value = corners[node * 8 + i];
      leaves.push(value);
      if (i % 2 === 0) maxLongitude = Math.max(maxLongitude, Math.abs(value));
      else maxLatitude = Math.max(maxLatitude, Math.abs(value));
    }
  }
  const stepLongitude = Math.max(maxLongitude / 32767, 1e-9);
  const stepLatitude = Math.max(maxLatitude / 32767, 1e-12);
  const treeBytes = Buffer.alloc(packedTree.length * 4);
  for (let i = 0; i < packedTree.length; i += 1)
    treeBytes.writeUInt32LE(packedTree[i], i * 4);
  const cornerBytes = Buffer.alloc(leaves.length * 2);
  for (let i = 0; i < leaves.length; i += 1)
    cornerBytes.writeInt16LE(
      Math.round(leaves[i] / (i % 2 === 0 ? stepLongitude : stepLatitude)),
      i * 2,
    );
  await MeshoptEncoder.ready;
  const treePayload = MeshoptEncoder.encodeVertexBuffer(
    treeBytes,
    packedTree.length,
    4,
  );
  const cornerPayload = MeshoptEncoder.encodeVertexBuffer(
    cornerBytes,
    leaves.length / 2,
    4,
  );
  const header = {
    formatVersion: 2,
    encoding: 'adaptive-quadtree-int16',
    width: rootWidth,
    height: rootHeight,
    maxDepth,
    verticalCoordinate: 'latitude',
    stepLongitude,
    stepLatitude,
    metric,
    level,
    stride: 4,
    treeNodes: packedTree.length,
    leafCount: leaves.length / 8,
    treeEncodedBytes: treePayload.length,
    cornerEncodedBytes: cornerPayload.length,
    encodedBytes: treePayload.length + cornerPayload.length,
  };
  const json = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.alloc(8);
  prefix.write('MRE2');
  prefix.writeUInt32LE(json.length, 4);
  const bytes = Buffer.concat([prefix, json, treePayload, cornerPayload]);
  const decoded = await decodeInverse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { metric, level },
  );
  const rawPacked = {
    ...decoded,
    corners: Float64Array.from(leaves),
    header: { ...header, stepLongitude: 1, stepLatitude: 1 },
  };
  let quantizationMaxDegrees = 0;
  const errors = new Float64Array(nodeCount),
    rawErrors = new Float64Array(nodeCount);
  let sample = 0;
  eachForward((source, at) => {
    const exact = sampleInverseCoordinates(rawPacked, ...at),
      encoded = sampleInverseCoordinates(decoded, ...at);
    quantizationMaxDegrees = Math.max(
      quantizationMaxDegrees,
      angularErrorDegrees(exact, encoded),
    );
    errors[sample] = angularErrorDegrees(source, encoded);
    rawErrors[sample++] = angularErrorDegrees(source, exact);
  });
  for (let node = 0; node < tree.length; node += 1) {
    if ((tree[node] & ADAPTIVE_LEAF_BIT) === 0) continue;
    const [ix, iy, size] = bounds[node];
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], ...PROBES]) {
      const x = (ix + fx * size) / latticeWidth,
        y = latitudeCoordinateToEqualArea((iy + fy * size) / latticeHeight);
      quantizationMaxDegrees = Math.max(
        quantizationMaxDegrees,
        angularErrorDegrees(
          sampleInverseCoordinates(rawPacked, x, y),
          sampleInverseCoordinates(decoded, x, y),
        ),
      );
    }
  }
  errors.sort();
  rawErrors.sort();
  const edgeContinuity = measureAdaptiveEdgeContinuity(decoded);
  const unquantizedEdges = measureAdaptiveEdgeContinuity(rawPacked);
  const summary = (array) => ({
    samples: array.length,
    p999Degrees: array[Math.ceil(array.length * 0.999) - 1],
    maxDegrees: array[array.length - 1],
  });
  return {
    bytes,
    header,
    roundTrip: summary(errors),
    quantizationMaxDegrees,
    edgeJumpMaxDegrees: edgeContinuity.maxDegrees,
    diagnostics: {
      interpolation: summary(rawErrors),
      refinementPasses,
      refined,
      saturated,
      exactQueries: samples.size,
      inverseQueries: exactInverse.diagnostics,
      gpuBytes: inverseTextureBytes(decoded),
      balanceRefinements,
      hangingCorners,
      edgeContinuity,
      unquantizedEdges,
    },
  };
}

export async function encodeInverseField(map, options) {
  return options?.encoding === 'regular'
    ? encodeRegularInverseField(map, options)
    : encodeAdaptiveInverseField(map, options);
}
