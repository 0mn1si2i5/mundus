const MAX_DISTANCE_PIXELS = 4;
const QUANTIZATION = 255 / MAX_DISTANCE_PIXELS;
const BLOCK_SIZE = 32;

function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`Unsupported country geometry ${geometry?.type}`);
}

function unwrappedRing(ring) {
  const result = [];
  let previous;
  let longitude;
  for (const point of ring) {
    const [rawLongitude, latitude] = point;
    if (previous === undefined) {
      previous = rawLongitude;
      longitude = rawLongitude;
    } else {
      let delta = rawLongitude - previous;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      longitude += delta;
      previous = rawLongitude;
    }
    result.push([longitude, latitude]);
  }
  // Natural Earth's polar caps explicitly close across the longitude range.
  if (result.length && Math.abs(result.at(-1)[0] - result[0][0]) > 180)
    return ring.map(([longitude, latitude]) => [longitude, latitude]);
  return result;
}

function normalizeFeature(feature, country) {
  const polygons = polygonsOf(feature.geometry).map((polygon) =>
    polygon.map(unwrappedRing),
  );
  const segments = [];
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [aLongitude, aLatitude] = ring[i];
        const [bLongitude, bLatitude] = ring[i + 1];
        if (aLongitude === bLongitude && aLatitude === bLatitude) continue;
        segments.push({
          country,
          aLongitude,
          aLatitude,
          bLongitude,
          bLatitude,
          minLatitude: Math.min(aLatitude, bLatitude),
          maxLatitude: Math.max(aLatitude, bLatitude),
        });
      }
  return { country, polygons, segments };
}

function segmentDistancePixels(segment, longitude, latitude, dx, dy) {
  const midpoint = (segment.aLongitude + segment.bLongitude) / 2;
  const shift = Math.round((longitude - midpoint) / 360) * 360;
  const scale = Math.cos((latitude * Math.PI) / 180);
  const ax = ((segment.aLongitude + shift - longitude) * scale) / dx;
  const bx = ((segment.bLongitude + shift - longitude) * scale) / dx;
  const ay = (segment.aLatitude - latitude) / dy;
  const by = (segment.bLatitude - latitude) / dy;
  const vx = bx - ax;
  const vy = by - ay;
  const denominator = vx * vx + vy * vy;
  const t = denominator
    ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / denominator))
    : 0;
  return Math.hypot(ax + t * vx, ay + t * vy);
}

function pixelRange(min, max, origin, step, limit) {
  return [
    Math.max(0, Math.floor((min - origin) / step)),
    Math.min(limit - 1, Math.ceil((max - origin) / step) - 1),
  ];
}

/**
 * Build a deterministic vector-derived boundary distance field. The block
 * index stores only segments whose four-pixel neighbourhood intersects a
 * 32x32 raster block, so every distance query remains local and periodic in
 * longitude. A vector/raster ownership mismatch is kept at zero.
 */
export function buildCountryDistanceField({
  width,
  height,
  ids,
  countries,
  features,
  onProgress = () => {},
}) {
  if (!Number.isInteger(width) || !Number.isInteger(height))
    throw new RangeError('Distance field dimensions must be integers');
  if (!ids || ids.length !== width * height)
    throw new RangeError('Distance field IDs have invalid dimensions');
  const featureById = new Map(
    features.map((feature) => [
      feature.id ?? feature.properties?.countryId,
      feature,
    ]),
  );
  const normalized = [];
  const labelsById = new Map(countries.map((c) => [c.id, c.paletteIndex]));
  // Independently classify every pixel centre from full vector rings. This
  // catches ownership mismatches even more than four pixels from an edge.
  const vectorIds = rasterizeFeatures(features, {
    width,
    height,
    getLabel: (feature) =>
      labelsById.get(feature.id ?? feature.properties?.countryId),
  }).labels;
  for (const country of countries) {
    const feature = featureById.get(country.id);
    if (!feature)
      throw new Error(`Missing vector country feature ${country.id}`);
    normalized.push(normalizeFeature(feature, country.paletteIndex));
  }
  const blockColumns = Math.ceil(width / BLOCK_SIZE);
  const blockRows = Math.ceil(height / BLOCK_SIZE);
  const blocks = Array.from({ length: blockColumns * blockRows }, () => []);
  const dx = 360 / width;
  const dy = 180 / height;
  const addSegmentToBlock = (segmentIndex, x, y) => {
    const block = blocks[y * blockColumns + x];
    if (block.at(-1) !== segmentIndex) block.push(segmentIndex);
  };
  const segments = [];
  for (const feature of normalized)
    for (const segment of feature.segments) {
      const segmentIndex = segments.length;
      segments.push(segment);
      const yRange = [
        Math.max(
          0,
          Math.floor(
            (90 - segment.maxLatitude - MAX_DISTANCE_PIXELS * dy) / dy,
          ),
        ),
        Math.min(
          height - 1,
          Math.ceil(
            (90 - segment.minLatitude + MAX_DISTANCE_PIXELS * dy) / dy,
          ) - 1,
        ),
      ];
      if (yRange[0] > yRange[1]) continue;
      const midpoint = (segment.aLongitude + segment.bLongitude) / 2;
      const halfWidth = Math.abs(segment.bLongitude - segment.aLongitude) / 2;
      for (
        let y = Math.floor(yRange[0] / BLOCK_SIZE);
        y <= Math.floor(yRange[1] / BLOCK_SIZE);
        y += 1
      ) {
        const north = 90 - (y * BLOCK_SIZE + 0.5) * dy;
        const south = 90 - (Math.min(height, (y + 1) * BLOCK_SIZE) - 0.5) * dy;
        const minimumCosine = Math.cos(
          (Math.max(Math.abs(north), Math.abs(south)) * Math.PI) / 180,
        );
        // Pixel distance scales longitude by cos(latitude). Expand the
        // candidate neighbourhood by its inverse so polar edges are not lost.
        const margin = Math.min(
          360,
          (MAX_DISTANCE_PIXELS * dx) / minimumCosine,
        );
        const firstTurn = Math.ceil(
          (-180 - midpoint - halfWidth - margin) / 360,
        );
        const lastTurn = Math.floor(
          (180 - midpoint + halfWidth + margin) / 360,
        );
        for (let turn = firstTurn; turn <= lastTurn; turn += 1) {
          const xRange = pixelRange(
            midpoint - halfWidth + 360 * turn - margin,
            midpoint + halfWidth + 360 * turn + margin,
            -180,
            dx,
            width,
          );
          if (xRange[0] > xRange[1]) continue;
          for (
            let x = Math.floor(xRange[0] / BLOCK_SIZE);
            x <= Math.floor(xRange[1] / BLOCK_SIZE);
            x += 1
          )
            if (x >= 0 && x < blockColumns && y >= 0 && y < blockRows)
              addSegmentToBlock(segmentIndex, x, y);
        }
      }
    }
  const result = new Uint8Array(ids.length);
  for (let blockY = 0; blockY < blockRows; blockY += 1) {
    for (let blockX = 0; blockX < blockColumns; blockX += 1) {
      const segmentIndices = blocks[blockY * blockColumns + blockX];
      for (
        let y = blockY * BLOCK_SIZE;
        y < Math.min(height, (blockY + 1) * BLOCK_SIZE);
        y += 1
      )
        for (
          let x = blockX * BLOCK_SIZE;
          x < Math.min(width, (blockX + 1) * BLOCK_SIZE);
          x += 1
        ) {
          const index = y * width + x;
          const id = ids[index];
          if (id !== vectorIds[index]) continue;
          const longitude = -180 + (x + 0.5) * dx;
          const latitude = 90 - (y + 0.5) * dy;
          let minimum = MAX_DISTANCE_PIXELS;
          for (const segmentIndex of segmentIndices) {
            const segment = segments[segmentIndex];
            if (id !== 0 && id !== segment.country) continue;
            const distance = segmentDistancePixels(
              segment,
              longitude,
              latitude,
              dx,
              dy,
            );
            if (distance < minimum) minimum = distance;
          }
          result[index] = Math.min(255, Math.round(minimum * QUANTIZATION));
        }
      onProgress({
        phase: 'country-distance',
        block: blockY * blockColumns + blockX,
      });
    }
  }
  return { distances: result, segments: segments.length, blocks };
}

import { rasterizeFeatures } from './units.mjs';
