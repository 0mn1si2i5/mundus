import assert from 'node:assert/strict';
import test from 'node:test';
import {
  depositTriangle,
  conservativeMappedDensity,
} from './conservative-density.mjs';
import { cartogramFromForwardGrid } from './cartogram.mjs';

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
