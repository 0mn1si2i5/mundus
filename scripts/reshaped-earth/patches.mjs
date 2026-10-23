import { gzipSync } from 'node:zlib';
import { writeRgbPng } from './png.mjs';

const PATCH_BASE_WIDTH = 4096;
const PATCH_BASE_HEIGHT = 2048;
const PATCH_SCALE = 8;
const PATCH_TRANSITION_WIDTH = PATCH_SCALE * 2;
const PATCH_LIMIT = 64;
const PATCH_GZIP_LIMIT = 150_000;
const PATCH_CORE_COUNTRIES = [
  'ne-344',
  'ne-446',
  'ne-702',
  'ne-492',
  'ne-048',
  'ne-470',
];

const METRICS = ['population', 'gdp', 'co2', 'lights'];
const DEG_X = 360 / PATCH_BASE_WIDTH;
const DEG_Y = 180 / PATCH_BASE_HEIGHT;
const LOCAL_DX = DEG_X / PATCH_SCALE;
const LOCAL_DY = DEG_Y / PATCH_SCALE;
const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const countryId = (feature) => feature.id ?? feature.properties?.countryId;
const toBounds = (bbox) =>
  Array.isArray(bbox)
    ? { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] }
    : bbox;

function rings(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates ?? [];
  if (geometry.type === 'MultiPolygon')
    return (geometry.coordinates ?? []).flat();
  return [];
}

function lonNear(value, reference) {
  return value + Math.round((reference - value) / 360) * 360;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  if (!ring || ring.length < 3) return false;
  let previous = ring[ring.length - 1];
  for (const current of ring) {
    const x0 = lonNear(previous[0], lon),
      x1 = lonNear(current[0], lon);
    if (
      previous[1] > lat !== current[1] > lat &&
      lon < x0 + ((lat - previous[1]) * (x1 - x0)) / (current[1] - previous[1])
    )
      inside = !inside;
    previous = current;
  }
  return inside;
}

function pointInPolygon(lon, lat, polygon) {
  if (!pointInRing(lon, lat, polygon[0])) return false;
  return !polygon.slice(1).some((ring) => pointInRing(lon, lat, ring));
}

/** The smallest periodic longitude interval containing all vector vertices. */
function circularBounds(feature) {
  const all = rings(feature)
    .flatMap((ring) => ring ?? [])
    .filter(
      (point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]),
    );
  if (!all.length)
    throw new Error(
      `Patch feature ${countryId(feature) ?? 'unknown'} has no coordinates`,
    );
  const longitudes = all
    .map((point) => (((point[0] + 180) % 360) + 360) % 360)
    .sort((a, b) => a - b);
  let largestGap = -1,
    gapAt = 0;
  for (let i = 0; i < longitudes.length; i += 1) {
    const next =
      i + 1 < longitudes.length ? longitudes[i + 1] : longitudes[0] + 360;
    if (next - longitudes[i] > largestGap) {
      largestGap = next - longitudes[i];
      gapAt = i;
    }
  }
  const west = longitudes[(gapAt + 1) % longitudes.length] - 180;
  let east = west,
    south = Infinity,
    north = -Infinity;
  for (const point of all) {
    let lon = lonNear(point[0], west);
    if (lon < west - 1e-9) lon += 360;
    east = Math.max(east, lon);
    south = Math.min(south, point[1]);
    north = Math.max(north, point[1]);
  }
  return { west, east, south, north };
}

/** Touching expanded boxes belong to one group, including at +/-180 degrees. */
function patchBoundsIntersect(first, second) {
  const a = toBounds(first),
    b = toBounds(second);
  if (a.north < b.south || a.south > b.north) return false;
  const shift = Math.round((a.west + a.east - (b.west + b.east)) / 720) * 360;
  for (const offset of [shift - 360, shift, shift + 360])
    if (b.east + offset >= a.west && b.west + offset <= a.east) return true;
  return false;
}

/** Each original polygon gets a 10%/one-base-pixel margin plus the soft seam. */
function patchBoundsForFeature(feature) {
  const raw = circularBounds(feature);
  const marginX = Math.max((raw.east - raw.west) * 0.1, DEG_X) + DEG_X * 2;
  const marginY = Math.max((raw.north - raw.south) * 0.1, DEG_Y) + DEG_Y * 2;
  return {
    west: raw.west - marginX,
    east: raw.east + marginX,
    south: Math.max(-90, raw.south - marginY),
    north: Math.min(90, raw.north + marginY),
  };
}

function polygonFeatures(feature) {
  const geometry = feature?.geometry;
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? (geometry.coordinates ?? [])
        : [];
  return polygons.map((coordinates, polygonIndex) => ({
    ...feature,
    geometry: { type: 'Polygon', coordinates },
    polygonIndex,
  }));
}

function featureFromMembers(members) {
  return {
    geometry: {
      type: 'MultiPolygon',
      coordinates: members.map((member) => member.feature.geometry.coordinates),
    },
  };
}

function mergePeriodicBounds(a, b) {
  const shift = Math.round((a.west + a.east - (b.west + b.east)) / 720) * 360;
  return {
    west: Math.min(a.west, b.west + shift),
    east: Math.max(a.east, b.east + shift),
    south: Math.min(a.south, b.south),
    north: Math.max(a.north, b.north),
  };
}

function compareMembers(a, b) {
  return (
    compareIds(a.countryId, b.countryId) || a.polygonIndex - b.polygonIndex
  );
}

function clusterMembers(members) {
  const groups = [...members].sort(compareMembers).map((member) => ({
    members: [member],
    bounds: patchBoundsForFeature(member.feature),
  }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < groups.length; i += 1)
      for (let j = i + 1; j < groups.length; j += 1) {
        if (!patchBoundsIntersect(groups[i].bounds, groups[j].bounds)) continue;
        groups[i].members.push(...groups[j].members);
        groups[i].members.sort(compareMembers);
        // Merge already expanded boxes. Reapplying a margin to the group
        // would repeatedly add empty ocean and change the requested rule.
        groups[i].bounds = mergePeriodicBounds(
          groups[i].bounds,
          groups[j].bounds,
        );
        groups.splice(j, 1);
        changed = true;
        break outer;
      }
  }
  groups.sort((a, b) => compareMembers(a.members[0], b.members[0]));
  const result = groups.map((group, groupIndex) => {
    const countries = [
      ...new Map(
        group.members.map((member) => [member.countryId, member]),
      ).values(),
    ].sort((a, b) => compareIds(a.countryId, b.countryId));
    return {
      ...group,
      groupIndex,
      countryIds: countries.map((country) => country.countryId),
      rasterIds: countries.map((country) => country.rasterId),
      feature: featureFromMembers(group.members),
    };
  });
  assertPatchBoundsDisjoint(result);
  return result;
}

/** Cluster all selected countries together, rather than one atlas block per country. */
function clusterPatchGroups({ selection, countryFeatures }) {
  const byId = new Map(
    countryFeatures.map((feature) => [countryId(feature), feature]),
  );
  const members = selection.flatMap((entry) => {
    const feature = byId.get(entry.countryId);
    if (!feature)
      throw new Error(`S9: patch feature missing: ${entry.countryId}`);
    return polygonFeatures(feature).map((polygon) => ({
      countryId: entry.countryId,
      rasterId: entry.rasterId,
      polygonIndex: polygon.polygonIndex,
      feature: polygon,
    }));
  });
  return clusterMembers(members);
}

/** Single-country helper retained for small, direct clustering tests. */
function clusterPatchPolygons(feature) {
  return clusterPatchGroups({
    selection: [{ countryId: countryId(feature), rasterId: 1 }],
    countryFeatures: [feature],
  }).map((group) => ({
    ...group,
    polygonIndices: group.members.map((member) => member.polygonIndex),
  }));
}

function assertPatchBoundsDisjoint(patches) {
  for (let i = 0; i < patches.length; i += 1)
    for (let j = i + 1; j < patches.length; j += 1)
      if (
        patchBoundsIntersect(
          patches[i].bounds ?? patches[i].bbox,
          patches[j].bounds ?? patches[j].bbox,
        )
      )
        throw new Error(`S9: overlapping patch groups ${i}/${j}`);
}

function ratioFor(field, id) {
  const actual = field?.effectiveAreas?.[id],
    target = field?.trueAreas?.[id];
  return actual > 0 && target > 0 ? actual / target : 0;
}

/** Select countries; the 64-block limit is checked after global clustering. */
function selectPatchCountries({
  classification,
  fields,
  publishedMetrics = METRICS,
}) {
  return classification.countries
    .filter((country) => country.areaKm2 < 200_000 && !country.excluded)
    .map((country) => {
      const ratios = Object.fromEntries(
        publishedMetrics.map((metric) => [
          metric,
          ratioFor(fields[metric], country.paletteIndex),
        ]),
      );
      return {
        countryId: country.id,
        rasterId: country.paletteIndex,
        areaKm2: country.areaKm2,
        maxAreaRatio: Math.max(0, ...Object.values(ratios)),
        areaRatios: ratios,
      };
    })
    .filter((country) => country.maxAreaRatio >= 10)
    .sort(
      (a, b) => a.rasterId - b.rasterId || compareIds(a.countryId, b.countryId),
    );
}

function baseOffset(base, longitude, latitude) {
  const x = Math.floor(((longitude + 180) / 360) * base.width);
  const y = Math.floor(((90 - latitude) / 180) * base.height);
  return (
    Math.min(base.height - 1, Math.max(0, y)) * base.width +
    (((x % base.width) + base.width) % base.width)
  );
}

/** Record national evidence from the complete base raster, including off-patch islands. */
function withBaseEvidence(selection, base) {
  const counts = new Map(
    selection.map((entry) => [entry.rasterId, { count: 0, bits: 0 }]),
  );
  for (let i = 0; i < base.ids.length; i += 1) {
    const evidence = counts.get(base.ids[i]);
    if (!evidence) continue;
    evidence.count += 1;
    evidence.bits |= base.padding?.[i] ?? 0;
  }
  return selection.map((entry) => ({
    ...entry,
    basePixelCount: counts.get(entry.rasterId).count,
    basePaddingBits: counts.get(entry.rasterId).bits,
  }));
}

/** A large base footprint is the first candidate for the deterministic fallback. */
function orderPatchRemovals(selection) {
  return [...selection].sort(
    (a, b) =>
      b.basePixelCount - a.basePixelCount ||
      compareIds(a.countryId, b.countryId),
  );
}

function boundsContainPoint(bounds, lon, lat) {
  const wrapped = lonNear(lon, (bounds.west + bounds.east) / 2);
  return (
    wrapped >= bounds.west &&
    wrapped <= bounds.east &&
    lat >= bounds.south &&
    lat <= bounds.north
  );
}

/** Prepare each vector polygon once; distant islands never enter a patch's pixel loop. */
function prepareGeometry(features, labelsById) {
  return features.flatMap((feature) =>
    polygonFeatures(feature).map((polygon) => {
      const bounds = circularBounds(polygon);
      const reference = (bounds.west + bounds.east) / 2;
      const segments = [];
      for (const ring of rings(polygon))
        for (let i = 1; i < ring.length; i += 1) {
          const a = ring[i - 1],
            b = ring[i];
          const x0 = lonNear(a[0], reference),
            x1 = lonNear(b[0], x0);
          segments.push([x0, a[1], x1, b[1]]);
        }
      return {
        feature: polygon,
        bounds,
        segments,
        label: labelsById.get(countryId(feature)) ?? 0,
      };
    }),
  );
}

/**
 * Distances are capped at four pixels, so only nearby vector segments matter.
 * Index their expanded boxes into small tiles instead of rescanning every
 * country's full coast for each ocean pixel. The latitude bound is conservative.
 */
function segmentIndex(geometry, bounds, dx, dy) {
  const maxLatitude = Math.max(Math.abs(bounds.south), Math.abs(bounds.north));
  const minimumCos = Math.max(0.05, Math.cos((maxLatitude * Math.PI) / 180));
  const radiusX = (4 * dx) / minimumCos,
    radiusY = 4 * dy;
  const tileWidth = (8 * dx) / minimumCos,
    tileHeight = 8 * dy;
  const columns = Math.max(
    1,
    Math.ceil((bounds.east - bounds.west) / tileWidth),
  );
  const rows = Math.max(
    1,
    Math.ceil((bounds.north - bounds.south) / tileHeight),
  );
  const bins = new Map();
  let segments = 0;
  const reference = (bounds.west + bounds.east) / 2;
  for (const item of geometry) {
    const shift =
      Math.round(
        (reference - (item.bounds.west + item.bounds.east) / 2) / 360,
      ) * 360;
    for (const original of item.segments) {
      const segment = [
        original[0] + shift,
        original[1],
        original[2] + shift,
        original[3],
        item.label,
      ];
      const left = Math.min(segment[0], segment[2]) - radiusX;
      const right = Math.max(segment[0], segment[2]) + radiusX;
      const bottom = Math.min(segment[1], segment[3]) - radiusY;
      const top = Math.max(segment[1], segment[3]) + radiusY;
      if (
        left > bounds.east ||
        right < bounds.west ||
        bottom > bounds.north ||
        top < bounds.south
      )
        continue;
      segments += 1;
      const x0 = Math.max(0, Math.floor((left - bounds.west) / tileWidth));
      const x1 = Math.min(
        columns - 1,
        Math.floor((right - bounds.west) / tileWidth),
      );
      const y0 = Math.max(0, Math.floor((bounds.north - top) / tileHeight));
      const y1 = Math.min(
        rows - 1,
        Math.floor((bounds.north - bottom) / tileHeight),
      );
      for (let y = y0; y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1) {
          const key = y * columns + x;
          if (!bins.has(key)) bins.set(key, []);
          bins.get(key).push(segment);
        }
    }
  }
  return {
    segments,
    at(lon, lat) {
      const x = Math.min(
        columns - 1,
        Math.max(0, Math.floor((lon - bounds.west) / tileWidth)),
      );
      const y = Math.min(
        rows - 1,
        Math.max(0, Math.floor((bounds.north - lat) / tileHeight)),
      );
      return bins.get(y * columns + x) ?? [];
    },
  };
}

function segmentDistance(lon, lat, segment, scaleX, scaleY) {
  const ax = (segment[0] - lon) * scaleX,
    ay = (segment[1] - lat) * scaleY;
  const bx = (segment[2] - lon) * scaleX,
    by = (segment[3] - lat) * scaleY;
  const vx = bx - ax,
    vy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, -(ax * vx + ay * vy) / Math.max(vx * vx + vy * vy, 1e-12)),
  );
  return Math.hypot(ax + t * vx, ay + t * vy);
}

function groupClearance(group, bounds, dx, dy) {
  let clearance = Infinity;
  const reference = (bounds.west + bounds.east) / 2;
  for (const member of group.members) {
    const raw = circularBounds(member.feature);
    const shift =
      Math.round((reference - (raw.west + raw.east) / 2) / 360) * 360;
    clearance = Math.min(
      clearance,
      (raw.west + shift - bounds.west) / dx,
      (bounds.east - raw.east - shift) / dx,
      (raw.south - bounds.south) / dy,
      (bounds.north - raw.north) / dy,
    );
  }
  return clearance;
}

/** Vector RGB labels for one globally disjoint local block. */
function makePatch({
  group,
  allFeatures,
  labelsById,
  base,
  preparedGeometry,
  onProgress = () => {},
}) {
  const bounds = group.bounds;
  const innerWidth = Math.max(
    4,
    Math.ceil((bounds.east - bounds.west) / LOCAL_DX),
  );
  const innerHeight = Math.max(
    4,
    Math.ceil((bounds.north - bounds.south) / LOCAL_DY),
  );
  const dx = (bounds.east - bounds.west) / innerWidth;
  const dy = (bounds.north - bounds.south) / innerHeight;
  const edgeClearancePixels = groupClearance(group, bounds, dx, dy);
  if (edgeClearancePixels < PATCH_TRANSITION_WIDTH + 4)
    throw new Error(
      `S9: patch countries ${group.countryIds.join(',')} do not fit inside transition band (${edgeClearancePixels}px)`,
    );
  const maxLatitude = Math.max(Math.abs(bounds.south), Math.abs(bounds.north));
  const minimumCos = Math.max(0.05, Math.cos((maxLatitude * Math.PI) / 180));
  // A coast just outside the rectangle still contributes a distance to its
  // ocean pixels. Classification is separately bounded to each polygon.
  const distanceBounds = {
    west: bounds.west - (4 * dx) / minimumCos,
    east: bounds.east + (4 * dx) / minimumCos,
    south: bounds.south - 4 * dy,
    north: bounds.north + 4 * dy,
  };
  const geometry = (
    preparedGeometry ?? prepareGeometry(allFeatures, labelsById)
  ).filter((item) => patchBoundsIntersect(item.bounds, distanceBounds));
  const distances = segmentIndex(geometry, bounds, dx, dy);
  const pixels = new Uint8Array(innerWidth * innerHeight * 3);
  const countryPaddingBitsById = Object.fromEntries(
    group.countryIds.map((id) => [id, 0]),
  );
  const selectedIds = new Map(
    group.rasterIds.map((id, index) => [id, group.countryIds[index]]),
  );
  const diagnostics = {
    pixels: innerWidth * innerHeight,
    polygons: geometry.length,
    indexedSegments: distances.segments,
    classificationPolygonChecks: 0,
    distanceSegmentChecks: 0,
  };
  let transitionBoundaryPixels = 0,
    labelMismatchPixels = 0;
  for (let y = 0; y < innerHeight; y += 1) {
    const lat = bounds.north - (y + 0.5) * dy;
    const scaleX = Math.max(0.05, Math.cos((lat * Math.PI) / 180)) / dx;
    const scaleY = 1 / dy;
    for (let x = 0; x < innerWidth; x += 1) {
      const lon = bounds.west + (x + 0.5) * dx;
      let id = 0;
      for (const item of geometry) {
        if (!boundsContainPoint(item.bounds, lon, lat)) continue;
        diagnostics.classificationPolygonChecks += 1;
        if (pointInPolygon(lon, lat, item.feature.geometry.coordinates)) {
          id = item.label;
          break;
        }
      }
      const offset = (y * innerWidth + x) * 3;
      const source = baseOffset(base, lon, lat);
      // A fine vector pixel must not borrow its neighbour's padding bits.
      const padding =
        id !== 0 && base.ids[source] === id ? (base.padding?.[source] ?? 0) : 0;
      pixels[offset] = id;
      pixels[offset + 1] = padding;
      const selectedId = selectedIds.get(id);
      if (selectedId) countryPaddingBitsById[selectedId] |= padding;
      let distance = 4;
      for (const segment of distances.at(lon, lat)) {
        if (id !== 0 && segment[4] !== id) continue;
        diagnostics.distanceSegmentChecks += 1;
        distance = Math.min(
          distance,
          segmentDistance(lon, lat, segment, scaleX, scaleY),
        );
      }
      pixels[offset + 2] = Math.round(distance * (255 / 4));
      if (
        (x < PATCH_TRANSITION_WIDTH ||
          x >= innerWidth - PATCH_TRANSITION_WIDTH ||
          y < PATCH_TRANSITION_WIDTH ||
          y >= innerHeight - PATCH_TRANSITION_WIDTH) &&
        pixels[offset + 2] < 255
      )
        transitionBoundaryPixels += 1;
      if (
        (x === 0 || x === innerWidth - 1 || y === 0 || y === innerHeight - 1) &&
        id !== base.ids[source]
      )
        labelMismatchPixels += 1;
    }
    if (y % 16 === 0 || y === innerHeight - 1)
      onProgress({
        patchGroup: group.groupIndex,
        countryIds: group.countryIds,
        patchRow: y + 1,
        patchRows: innerHeight,
        ...diagnostics,
      });
  }
  const width = innerWidth + 2,
    height = innerHeight + 2;
  const edged = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(innerHeight - 1, Math.max(0, y - 1));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(innerWidth - 1, Math.max(0, x - 1));
      const source = (sy * innerWidth + sx) * 3,
        target = (y * width + x) * 3;
      edged.set(pixels.subarray(source, source + 3), target);
    }
  }
  return {
    countryIds: group.countryIds,
    rasterIds: group.rasterIds,
    groupIndex: group.groupIndex,
    polygonMembers: group.members.map(({ countryId: id, polygonIndex }) => ({
      countryId: id,
      polygonIndex,
    })),
    bbox: [bounds.west, bounds.south, bounds.east, bounds.north],
    width,
    height,
    blockWidth: width,
    blockHeight: height,
    innerWidth,
    innerHeight,
    pixels: edged,
    transitionWidthPixels: PATCH_TRANSITION_WIDTH,
    transitionBoundaryPixels,
    labelMismatchPixels,
    edgeClearancePixels,
    countryPaddingBits: Object.values(countryPaddingBitsById).reduce(
      (bits, value) => bits | value,
      0,
    ),
    countryPaddingBitsById,
    diagnostics,
  };
}

function packShelf(patches) {
  const sorted = [...patches].sort(
    (a, b) =>
      b.height - a.height || b.width - a.width || a.groupIndex - b.groupIndex,
  );
  const width = 2048;
  let x = 0,
    y = 0,
    rowHeight = 0;
  for (const patch of sorted) {
    if (patch.width > width)
      throw new Error(
        `S9: patch ${patch.countryIds.join(',')} width ${patch.width} exceeds atlas width`,
      );
    if (x + patch.width > width) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    patch.atlas = { x, y, width: patch.width, height: patch.height };
    x += patch.width;
    rowHeight = Math.max(rowHeight, patch.height);
  }
  const height = Math.max(1, y + rowHeight);
  const data = new Uint8Array(width * height * 3);
  for (const patch of sorted)
    for (let py = 0; py < patch.height; py += 1) {
      const source = py * patch.width * 3;
      const target = ((patch.atlas.y + py) * width + patch.atlas.x) * 3;
      data.set(patch.pixels.subarray(source, source + patch.width * 3), target);
    }
  return { width, height, data, patches: sorted };
}

export async function buildPatchAtlas({
  classification,
  fields,
  publishedMetrics = METRICS,
  countryFeatures,
  baseRaster,
  onProgress = () => {},
  gzipLimit = PATCH_GZIP_LIMIT,
}) {
  if (
    !Number.isInteger(gzipLimit) ||
    gzipLimit < 0 ||
    gzipLimit > PATCH_GZIP_LIMIT
  )
    throw new RangeError(
      'Patch gzip limit may only tighten the production budget',
    );
  const selection = withBaseEvidence(
    selectPatchCountries({ classification, fields, publishedMetrics }),
    baseRaster,
  );
  const removalOrder = orderPatchRemovals(selection);
  const labelsById = new Map(
    classification.countries.map((country) => [
      country.id,
      country.paletteIndex,
    ]),
  );
  const geometry = prepareGeometry(countryFeatures, labelsById);
  const patchCache = new Map();
  const removals = [],
    budgetSteps = [];
  const diagnostics = {
    generatedBlocks: 0,
    reusedBlocks: 0,
    rasterizedPixels: 0,
    distanceSegmentChecks: 0,
  };
  let retainedSelection = [...selection];
  for (let step = 0; ; step += 1) {
    const groups = clusterPatchGroups({
      selection: retainedSelection,
      countryFeatures,
    });
    if (groups.length > PATCH_LIMIT) {
      const error = new Error(
        `S9: reshaped ID patch count ${groups.length}/${PATCH_LIMIT}`,
      );
      error.report = {
        selection,
        removals,
        budgetSteps,
        diagnostics,
        patches: groups.length,
      };
      throw error;
    }
    const patches = groups.map((group) => {
      const key = JSON.stringify({
        bounds: group.bounds,
        members: group.members.map((member) => [
          member.countryId,
          member.polygonIndex,
        ]),
      });
      if (patchCache.has(key)) {
        diagnostics.reusedBlocks += 1;
        return { ...patchCache.get(key), groupIndex: group.groupIndex };
      }
      const patch = makePatch({
        group,
        preparedGeometry: geometry,
        base: baseRaster,
        onProgress,
      });
      patchCache.set(key, patch);
      diagnostics.generatedBlocks += 1;
      diagnostics.rasterizedPixels += patch.diagnostics.pixels;
      diagnostics.distanceSegmentChecks +=
        patch.diagnostics.distanceSegmentChecks;
      return patch;
    });
    assertPatchBoundsDisjoint(patches);
    const atlas = packShelf(patches);
    const png = writeRgbPng(atlas.width, atlas.height, atlas.data);
    const gzipBytes = gzipSync(png, { level: 6 }).length;
    const budgetStep = {
      step,
      removedCountryId: removals.at(-1)?.countryId ?? null,
      countryIds: retainedSelection.map((entry) => entry.countryId),
      patches: groups.length,
      gzipBytes,
      width: atlas.width,
      height: atlas.height,
      gpuBytes: atlas.width * atlas.height * 3,
    };
    budgetSteps.push(budgetStep);
    onProgress({ patchBudget: budgetStep, ...diagnostics });
    if (gzipBytes <= gzipLimit) {
      return {
        png,
        gzipBytes,
        width: atlas.width,
        height: atlas.height,
        entries: atlas.patches.map(({ pixels: _pixels, ...patch }) => patch),
        selection,
        retainedSelection,
        removals,
        budgetSteps,
        diagnostics,
      };
    }
    const next = removalOrder.find((entry) =>
      retainedSelection.some(
        (candidate) => candidate.countryId === entry.countryId,
      ),
    );
    if (!next || PATCH_CORE_COUNTRIES.includes(next.countryId)) {
      const error = new Error(
        next
          ? `S9: patch gzip ${gzipBytes}/${gzipLimit} would remove core country ${next.countryId}`
          : `S9: ids-patches.png gzip ${gzipBytes}/${gzipLimit} after removing every candidate`,
      );
      error.report = {
        selection,
        retainedSelection,
        removals,
        budgetSteps,
        nextRemoval: next ?? null,
        diagnostics,
      };
      throw error;
    }
    removals.push({
      countryId: next.countryId,
      rasterId: next.rasterId,
      basePixelCount: next.basePixelCount,
      step: step + 1,
      gzipBytesBefore: gzipBytes,
    });
    retainedSelection = retainedSelection.filter(
      (entry) => entry.countryId !== next.countryId,
    );
  }
}

// Numerical and format probes for boundary tests; not a supported build API.
export const __test = Object.freeze({
  circularBounds,
  patchBoundsForFeature,
  clusterPatchGroups,
  clusterPatchPolygons,
  assertPatchBoundsDisjoint,
  selectPatchCountries,
  orderPatchRemovals,
  makePatch,
});
