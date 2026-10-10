import assert from 'node:assert/strict';
import test from 'node:test';
import { cartogramFromForwardGrid } from './cartogram.mjs';
import {
  createTriangleInverseIndex,
  createRobustTriangleInverse,
} from './triangle-inverse.mjs';

function mesh(width, height, forward) {
  const grid = new Float64Array((width + 1) * (height + 1) * 2);
  for (let y = 0; y <= height; y += 1)
    for (let x = 0; x <= width; x += 1)
      grid.set(forward(x / width, y / height), (y * (width + 1) + x) * 2);
  return cartogramFromForwardGrid({ width, height, forwardGrid: grid });
}
const periodicError = (a, b) => Math.abs(a - b - Math.round(a - b));

test('triangle-bin inverse covers both triangles, seam copies and reflecting endpoints', () => {
  const map = mesh(32, 16, (x, y) => [
    x - 0.2 + 0.075 * Math.sin(2 * Math.PI * x) * Math.sin(Math.PI * y),
    y,
  ]);
  const inverse = createTriangleInverseIndex(map, { width: 8, height: 4 });
  for (const x of [-0.001, 0, 0.001, 0.35, 0.4999, 0.9, 0.9999, 1, 1.001])
    for (const y of [0, 0.001, 0.37, 0.5, 0.999, 1]) {
      const at = map.forward(x, y),
        back = inverse(...at);
      assert.ok(
        periodicError(back[0], x) < 1e-12,
        JSON.stringify({ x, y, at, back }),
      );
      assert.ok(Math.abs(back[1] - y) < 1e-12);
    }
});

test('failed Newton uses an exact indexed triangle, and unrelated failures remain failures', () => {
  const map = mesh(8, 4, (x, y) => [x, y]);
  map.inverse = () => {
    throw new Error('Triangle inverse did not converge at a compressed cell');
  };
  const inverse = createRobustTriangleInverse(map);
  assert.deepEqual(inverse(0.375, 0.5), [0.375, 0.5]);
  assert.equal(inverse.diagnostics.newtonFailures, 1);
  assert.equal(inverse.diagnostics.indexedQueries, 1);
  assert.ok(inverse.diagnostics.index.references > 0);
  map.inverse = () => {
    throw new Error('S3: resource gate');
  };
  assert.throws(() => inverse(0.5, 0.5), /S3/);
});

test('indexed inverse rejects folded triangles rather than hiding invalid topology', () => {
  const map = mesh(4, 2, (x, y) => [1 - x, y]);
  assert.throws(() => createTriangleInverseIndex(map), /folded/);
});
