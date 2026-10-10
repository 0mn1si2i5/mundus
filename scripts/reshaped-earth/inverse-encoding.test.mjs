import assert from 'node:assert/strict';
import test from 'node:test';
import { createCartogram } from './cartogram.mjs';
import { encodeInverseField } from './inverse-encoding.mjs';

test('production country header and meshopt decoder preserve identity byte-for-byte', async () => {
  const map = createCartogram({
    width: 8,
    height: 4,
    density: new Float64Array(32).fill(1),
    algorithm: 'gsm2018',
  });
  const first = await encodeInverseField(map, {
    metric: 'population',
    level: 'country',
  });
  const second = await encodeInverseField(map, {
    metric: 'population',
    level: 'country',
  });
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.header.width, 512);
  assert.equal(first.quantizationMaxDegrees, 0);
  assert.equal(first.roundTrip.maxDegrees, 0);
  assert.ok(first.bytes.length < 250 * 1024);
});

test('actual smooth flow validates encoded runtime interpolation including poles and seam', async () => {
  const density = Float64Array.from(
    { length: 32 * 16 },
    (_, i) =>
      1 +
      0.3 *
        Math.cos((2 * Math.PI * ((i % 32) + 0.5)) / 32) *
        Math.cos((Math.PI * (Math.floor(i / 32) + 0.5)) / 16),
  );
  const map = createCartogram({
    width: 32,
    height: 16,
    density,
    algorithm: 'gsm2018',
  });
  const field = await encodeInverseField(map, {
    metric: 'gdp',
    level: 'country',
  });
  assert.ok(field.quantizationMaxDegrees < 0.01, JSON.stringify(field));
  assert.ok(
    field.roundTrip.p999Degrees < 0.05,
    JSON.stringify(field.roundTrip),
  );
  assert.ok(field.roundTrip.maxDegrees < 0.5);
});
