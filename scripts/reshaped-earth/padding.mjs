import { open } from 'node:fs/promises';

export const METRIC_BITS = { population: 0, gdp: 1, co2: 2, lights: 3 };

/** Same nearest-centre sampling used for the published country raster. */
export async function loadCountryRaster(
  c,
  { width = 4096, height = 2048 } = {},
) {
  if (c.countries.length > 255)
    throw new Error('Country IDs exceed RGB8 R channel');
  const ids = new Uint8Array(width * height);
  const row = Buffer.alloc(c.width * 2);
  const input = await open(c.labelPath, 'r');
  try {
    for (let y = 0; y < height; y += 1) {
      const sy = Math.floor(((y + 0.5) * c.height) / height);
      let offset = 0;
      while (offset < row.length) {
        const { bytesRead } = await input.read(
          row,
          offset,
          row.length - offset,
          sy * row.length + offset,
        );
        if (!bytesRead) throw new Error('Truncated classification label row');
        offset += bytesRead;
      }
      for (let x = 0; x < width; x += 1) {
        const label = row.readUInt16LE(
          Math.floor(((x + 0.5) * c.width) / width) * 2,
        );
        const parent = c.adminToCountryIndex[label];
        if (
          !Number.isInteger(parent) ||
          parent < 0 ||
          parent > c.countries.length
        )
          throw new Error(`Unknown country for classification label ${label}`);
        ids[y * width + x] = parent;
      }
    }
  } finally {
    await input.close();
  }
  return { width, height, ids };
}

/** Multi-source 8-neighbour spherical chamfer; x is periodic, distances in radians. */
export function countryBoundaryDistances(
  { width, height, ids },
  { active, onProgress = () => {} } = {},
) {
  const n = ids.length;
  if (n !== width * height)
    throw new Error('Invalid country raster dimensions');
  const distance = new Float64Array(n).fill(Infinity);
  const positions = new Int32Array(n).fill(-1);
  const heap = new Uint32Array(n);
  let size = 0;
  const less = (a, b) =>
    distance[a] < distance[b] || (distance[a] === distance[b] && a < b);
  function rise(position) {
    const id = heap[position];
    while (position > 0) {
      const parent = (position - 1) >>> 1;
      if (!less(id, heap[parent])) break;
      heap[position] = heap[parent];
      positions[heap[position]] = position;
      position = parent;
    }
    heap[position] = id;
    positions[id] = position;
  }
  function push(id) {
    if (positions[id] < 0) {
      heap[size] = id;
      positions[id] = size++;
    }
    rise(positions[id]);
  }
  function pop() {
    const id = heap[0];
    positions[id] = -2;
    size -= 1;
    if (size) {
      const last = heap[size];
      let position = 0;
      while (position * 2 + 1 < size) {
        let child = position * 2 + 1;
        if (child + 1 < size && less(heap[child + 1], heap[child])) child += 1;
        if (!less(heap[child], last)) break;
        heap[position] = heap[child];
        positions[heap[position]] = position;
        position = child;
      }
      heap[position] = last;
      positions[last] = position;
    }
    return id;
  }
  const dlat = Math.PI / height,
    dlon = (2 * Math.PI) / width;
  const horizontal = new Float64Array(height);
  const diagonal = new Float64Array(Math.max(0, height - 1));
  for (let y = 0; y < height; y += 1) {
    horizontal[y] = dlon * Math.cos(Math.PI / 2 - (y + 0.5) * dlat);
    if (y + 1 < height)
      diagonal[y] = Math.hypot(
        dlat,
        dlon * Math.cos(Math.PI / 2 - (y + 1) * dlat),
      );
  }
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x,
        country = ids[index];
      if (!country || (active && !active.has(country))) continue;
      let boundary = y === 0 || y === height - 1;
      for (let dy = -1; dy <= 1 && !boundary; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          if (ids[(y + dy) * width + ((x + dx + width) % width)] !== country) {
            boundary = true;
            break;
          }
        }
      if (boundary) {
        distance[index] = 0;
        push(index);
      }
    }
  let processed = 0;
  while (size) {
    const index = pop(),
      y = Math.floor(index / width),
      x = index % width,
      country = ids[index];
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const next = ny * width + ((x + dx + width) % width);
        if (ids[next] !== country || positions[next] === -2) continue;
        const edge = !dy
          ? horizontal[y]
          : !dx
            ? dlat
            : diagonal[Math.min(y, ny)];
        const candidate = distance[index] + edge;
        if (candidate < distance[next]) {
          distance[next] = candidate;
          push(next);
        }
      }
    }
    processed += 1;
    if (processed % 262144 === 0)
      onProgress({ paddingDistancePixels: processed });
  }
  return distance;
}

/** Areas are fractions of 4π, matching the forward-triangle coverage evaluation. */
export function computeCountryPadding({
  raster,
  map,
  countries,
  actualAreas,
  targetAreas,
  minimumPixels = 64,
  onProgress = () => {},
}) {
  const { width, height, ids } = raster;
  const counts = new Uint32Array(countries.length + 1);
  for (const id of ids) counts[id] += 1;
  const eligible = [],
    skippedCountries = [];
  for (const country of countries) {
    const id = country.paletteIndex,
      target = targetAreas.get(id),
      actual = actualAreas.get(id);
    if (country.excluded || !(target > 0) || !(actual > 1.1 * target)) continue;
    if (counts[id] < minimumPixels) {
      skippedCountries.push({
        id: country.id,
        paletteIndex: id,
        pixelCount: counts[id],
      });
      continue;
    }
    eligible.push(country);
  }
  const mask = new Uint8Array(ids.length);
  const effectiveAreas = new Map(actualAreas);
  const records = [];
  if (eligible.length) {
    const active = new Set(eligible.map((c) => c.paletteIndex));
    const distance = countryBoundaryDistances(raster, { active, onProgress });
    const pixels = new Map(
      eligible.map((c) => [
        c.paletteIndex,
        new Uint32Array(counts[c.paletteIndex]),
      ]),
    );
    const offsets = new Uint32Array(counts.length),
      areas = new Float64Array(ids.length);
    for (let y = 0; y < height; y += 1) {
      const north = Math.cos((y * Math.PI) / height),
        south = Math.cos(((y + 1) * Math.PI) / height);
      const pixelArea = (north - south) / (2 * width);
      const s = (Math.cos(((y + 0.5) * Math.PI) / height) + 1) / 2;
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x,
          id = ids[index];
        if (!active.has(id)) continue;
        const jacobian = map.jacobian((x + 0.5) / width, s);
        if (!(jacobian > 0))
          throw new Error(`Non-positive padding pixel Jacobian at ${index}`);
        areas[index] = pixelArea * jacobian;
        pixels.get(id)[offsets[id]++] = index;
      }
      if (y % 128 === 0) onProgress({ paddingAreaRow: y });
    }
    for (const country of eligible) {
      const id = country.paletteIndex,
        targetArea = targetAreas.get(id),
        actualArea = actualAreas.get(id);
      const indices = pixels.get(id);
      indices.sort((a, b) => distance[b] - distance[a] || a - b);
      let coreArea = 0,
        rasterActualArea = 0,
        lastPixelArea = 0,
        corePixels = 0;
      for (const index of indices) {
        rasterActualArea += areas[index];
        if (coreArea < targetArea) {
          coreArea += areas[index];
          lastPixelArea = areas[index];
          corePixels += 1;
        } else mask[index] = 1;
      }
      const relativeError = Math.abs(coreArea - targetArea) / targetArea;
      const onePixelRelativeError = lastPixelArea / targetArea;
      if (
        coreArea < targetArea ||
        relativeError > onePixelRelativeError + 1e-12
      )
        throw new Error(
          `S6′: ${country.id}: padding core cannot reach target within one pixel (${relativeError})`,
        );
      const paddingArea = actualArea - coreArea;
      effectiveAreas.set(id, coreArea);
      records.push({
        id: country.id,
        paletteIndex: id,
        actualArea,
        rasterActualArea,
        targetArea,
        coreArea,
        paddingArea,
        paddingFraction: paddingArea / actualArea,
        rasterPaddingArea: rasterActualArea - coreArea,
        onePixelRelativeError,
        pixelCount: counts[id],
        corePixels,
      });
      onProgress({
        paddingCountry: country.id,
        coreRelativeError: relativeError,
      });
    }
  }
  return {
    mask,
    effectiveAreas,
    summary: {
      algorithm: 'spherical-chamfer-8',
      triggerRatio: 1.1,
      minimumPixels,
      countries: records,
      skippedCountries,
      maxFraction: Math.max(0, ...records.map((r) => r.paddingFraction)),
    },
  };
}
