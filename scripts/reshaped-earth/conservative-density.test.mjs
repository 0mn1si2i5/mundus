import assert from 'node:assert/strict';
import test from 'node:test';
import {
  depositTriangle,
  conservativeMappedDensity,
} from './conservative-density.mjs';
import { cartogramFromForwardGrid } from './cartogram.mjs';
import { averageDensity } from './production-field.mjs';

test('finite-volume triangle transport conserves mass across the periodic seam', () => {
  const output = new Float64Array(8);
  const mass = depositTriangle(
    output,
    4,
    2,
    [
      [0.75, 0],
      [1.25, 0],
      [1.25, 1],
    ],
    3,
  );
  assert.ok(Math.abs(mass - 3) < 1e-12);
  assert.ok(Math.abs(output.reduce((a, b) => a + b, 0) - 3) < 1e-12);
  assert.ok(output[0] > 0 && output[3] > 0);
});

test('conservative correction keeps an identity uniform field and all unit target mass', () => {
  const map = cartogramFromForwardGrid({
    width: 1,
    height: 1,
    forwardGrid: Float64Array.from([0, 0, 1, 0, 0, 1, 1, 1]),
  });
  const coverage = {
    chunks: [
      {
        startTriangle: 0,
        offsets: Uint32Array.from([0, 1, 2]),
        labels: Uint16Array.from([1, 2]),
        weights: Float64Array.from([0.5, 0.5]),
      },
    ],
  };
  const model = {
    targetAreas: new Map([
      [1, 0.25],
      [2, 0.75],
    ]),
  };
  const result = conservativeMappedDensity(
    map,
    coverage,
    model,
    new Map([
      [1, 0.5],
      [2, 0.5],
    ]),
  );
  assert.equal(result.sourceMass, 1);
  assert.equal(result.transportedMass, 1);
  assert.deepEqual([...result.density], [1]);
});

test('direct coarse transport equals equal-area averages of a finer transport', () => {
  const map = cartogramFromForwardGrid({
    width: 2,
    height: 2,
    forwardGrid: Float64Array.from([
      0.12, 0, 0.57, 0, 1.12, 0, 0.04, 0.4, 0.7, 0.6, 1.04, 0.4, -0.08, 1, 0.48,
      1, 0.92, 1,
    ]),
  });
  const coverage = {
    chunks: [
      {
        startTriangle: 0,
        offsets: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]),
        labels: Uint16Array.from([1, 1, 2, 2, 1, 1, 2, 2]),
        weights: new Float64Array(8).fill(0.125),
      },
    ],
  };
  const model = {
    targetAreas: new Map([
      [1, 0.3],
      [2, 0.7],
    ]),
  };
  const areas = new Map([
    [1, 0.605],
    [2, 0.395],
  ]);
  // Measure the exact positive triangle areas for the two source labels.
  areas.set(1, 0);
  areas.set(2, 0);
  for (let y = 0; y < 2; y += 1)
    for (let x = 0; x < 2; x += 1) {
      const a = 2 * (y * 3 + x),
        b = a + 2,
        d = a + 6,
        c = d + 2;
      for (const [i, j] of [
        [b, c],
        [c, d],
      ]) {
        const area =
          ((map.forwardGrid[i] - map.forwardGrid[a]) *
            (map.forwardGrid[j + 1] - map.forwardGrid[a + 1]) -
            (map.forwardGrid[i + 1] - map.forwardGrid[a + 1]) *
              (map.forwardGrid[j] - map.forwardGrid[a])) /
          2;
        const label = x + 1;
        areas.set(label, areas.get(label) + area);
      }
    }
  const coarse = conservativeMappedDensity(map, coverage, model, areas, {
    width: 4,
    height: 2,
  });
  const fine = conservativeMappedDensity(map, coverage, model, areas, {
    width: 8,
    height: 4,
  });
  const averaged = averageDensity(fine.density, 8, 4, 2);
  for (let i = 0; i < averaged.length; i += 1)
    assert.ok(Math.abs(coarse.density[i] - averaged[i]) < 1e-12);
  assert.ok(coarse.conservationRelativeError < 1e-12);
});
