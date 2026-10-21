import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateToGrid, countsToRgb, quantizeGrid } from './aggregate.mjs';
import { coarsenCounts, findSmallestHalfCircle } from './search.mjs';
import { writeRgbPng } from '../reshaped-earth/png.mjs';
import { decodePngRgb } from '../../src/features/reshaped/pngCore.mjs';
import {
  populationProfile,
  populationWithin,
  prepareCells,
  radiusForShare,
} from '../../src/features/circle/circleProfile.mjs';

function syntheticReader(rows, { bounds = [-180, -90, 180, 90], nodata } = {}) {
  return {
    metadata: {
      width: rows[0].length,
      height: rows.length,
      bounds,
      scale: 1,
      offset: 0,
      nodata: nodata ?? null,
    },
    async *rows() {
      for (let row = 0; row < rows.length; row += 1)
        yield { row, values: Float64Array.from(rows[row]) };
    },
  };
}

test('aggregates source pixels by centre and conserves the total', async () => {
  // 8×4 source onto a 4×2 grid: each target cell takes a 2×2 block.
  const rows = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 8 }, (_, column) => row * 8 + column + 0.25),
  );
  const result = await aggregateToGrid(syntheticReader(rows), {
    width: 4,
    height: 2,
  });
  const expected = [0, 0, 0, 0, 0, 0, 0, 0];
  rows.forEach((values, row) =>
    values.forEach((value, column) => {
      expected[Math.floor(row / 2) * 4 + Math.floor(column / 2)] += value;
    }),
  );
  assert.deepEqual([...result.sums], expected);
  assert.equal(result.gridTotal, result.sourceTotal);
});

test('wraps longitudes that overhang the antimeridian', async () => {
  const result = await aggregateToGrid(
    syntheticReader([[5, 7]], { bounds: [179.5, -90, 180.5, 90] }),
    { width: 4, height: 1 },
  );
  assert.equal(result.sums[3], 5);
  assert.equal(result.sums[0], 7);
});

test('rejects negative populations but skips declared nodata', async () => {
  await assert.rejects(
    aggregateToGrid(syntheticReader([[1, -1]]), { width: 2, height: 1 }),
    /Invalid population/,
  );
  const skipped = await aggregateToGrid(
    syntheticReader([[1, -200]], { nodata: -200 }),
    { width: 2, height: 1 },
  );
  assert.equal(skipped.sourceTotal, 1);
});

test('quantizes to tens only when a cell overflows 24 bits', () => {
  const small = quantizeGrid({
    width: 2,
    height: 1,
    sums: Float64Array.of(4.6, 16_777_214),
  });
  assert.equal(small.unit, 1);
  assert.deepEqual([...small.counts], [5, 16_777_214]);
  const large = quantizeGrid({
    width: 2,
    height: 1,
    sums: Float64Array.of(4.6, 20_000_004),
  });
  assert.equal(large.unit, 10);
  assert.deepEqual([...large.counts], [0, 2_000_000]);
});

test('PNG round trip preserves 24-bit counts exactly', async () => {
  const counts = Uint32Array.of(0, 1, 255, 256, 65_535, 65_536, 16_777_215, 7);
  const png = writeRgbPng(4, 2, countsToRgb({ width: 4, height: 2, counts }));
  const decoded = await decodePngRgb(
    png.buffer.slice(png.byteOffset, png.byteOffset + png.length),
  );
  assert.deepEqual([...decoded.ids], [...counts]);
});

test('half radius matches a brute-force weighted median', () => {
  const width = 72;
  const height = 36;
  const counts = new Float64Array(width * height);
  let seed = 7;
  for (let i = 0; i < counts.length; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    counts[i] = seed % 5 === 0 ? seed % 1000 : 0;
  }
  const cells = prepareCells(counts, width, height);
  const centre = { latitude: 23.5, longitude: 91.2 };
  const profile = populationProfile(cells, centre.latitude, centre.longitude);
  const radius = radiusForShare(profile, 0.5);
  const distances = [];
  for (let i = 0; i < cells.count; i += 1) {
    const lat = (centre.latitude * Math.PI) / 180;
    const lon = (centre.longitude * Math.PI) / 180;
    const dot =
      cells.x[i] * Math.cos(lat) * Math.sin(lon) +
      cells.y[i] * Math.sin(lat) +
      cells.z[i] * Math.cos(lat) * Math.cos(lon);
    distances.push([
      Math.acos(Math.max(-1, Math.min(1, dot))) * 6371.0088,
      cells.population[i],
    ]);
  }
  distances.sort((a, b) => a[0] - b[0]);
  let sum = 0;
  let median = 0;
  for (const [distance, population] of distances) {
    sum += population;
    if (sum >= cells.total / 2) {
      median = distance;
      break;
    }
  }
  assert.ok(Math.abs(radius - median) <= 1, `${radius} vs ${median}`);
  assert.ok(
    Math.abs(populationWithin(profile, radius) - cells.total / 2) <
      cells.total * 1e-9,
  );
});

test('a circle and its antipodal complement hold the whole population', () => {
  const counts = new Float64Array(36 * 18);
  counts[5 * 36 + 20] = 100;
  counts[12 * 36 + 3] = 50;
  const cells = prepareCells(counts, 36, 18);
  const radius = 4321.5;
  const here = populationProfile(cells, 10, 20);
  const there = populationProfile(cells, -10, -160);
  const complement = Math.PI * 6371.0088 - radius;
  assert.equal(
    populationWithin(here, radius) + populationWithin(there, complement),
    150,
  );
});

test('finds the dense cluster as the smallest half circle', () => {
  const width = 144;
  const height = 72;
  const counts = new Float64Array(width * height);
  counts.fill(1);
  const cell = (latitude, longitude) =>
    Math.floor(((90 - latitude) / 180) * height) * width +
    Math.floor(((longitude + 180) / 360) * width);
  for (let dy = -2; dy <= 2; dy += 1)
    for (let dx = -2; dx <= 2; dx += 1)
      counts[cell(25 + dy * 2.5, 90 + dx * 2.5)] = 2000;
  const result = findSmallestHalfCircle(
    { width, height, counts },
    { coarseFactor: 4, coarseStep: 5, keep: 4 },
  );
  assert.ok(Math.abs(result.latitude - 25) < 3, JSON.stringify(result));
  assert.ok(Math.abs(result.longitude - 90) < 3, JSON.stringify(result));
  assert.ok(result.radiusKm < 600, JSON.stringify(result));
});

test('coarsening conserves population', () => {
  const counts = Float64Array.from({ length: 16 }, (_, i) => i);
  const coarse = coarsenCounts({ width: 4, height: 4, counts }, 2);
  assert.deepEqual([...coarse.counts], [10, 18, 42, 50]);
});
