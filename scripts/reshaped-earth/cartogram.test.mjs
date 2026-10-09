import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areaRelativeError,
  createCartogram,
  dct,
  fftRadix2,
  idct,
  ifftRadix2,
  polygonSignedArea,
  summarizeAreaErrors,
} from './cartogram.mjs';

function naiveDft(values, inverse = false) {
  const n = values.length;
  const sign = inverse ? 1 : -1;
  const output = [];
  for (let k = 0; k < n; k += 1) {
    let real = 0;
    let imag = 0;
    for (let i = 0; i < n; i += 1) {
      const angle = (sign * 2 * Math.PI * k * i) / n;
      real += values[i] * Math.cos(angle);
      imag += values[i] * Math.sin(angle);
    }
    output.push([inverse ? real / n : real, inverse ? imag / n : imag]);
  }
  return output;
}

test('radix-2 FFT agrees with a naive DFT and round-trips', () => {
  const input = Float64Array.from([0.5, -1, 2, 0.25, 3, 1.5, -2, 0]);
  const actual = fftRadix2(input);
  const expected = naiveDft(input);
  for (let i = 0; i < input.length; i += 1) {
    assert.ok(Math.abs(actual.real[i] - expected[i][0]) < 1e-9);
    assert.ok(Math.abs(actual.imag[i] - expected[i][1]) < 1e-9);
  }
  const roundTrip = ifftRadix2(actual);
  assert.deepEqual(
    Array.from(roundTrip, (value) => Number(value.toFixed(12))),
    Array.from(input, (value) => Number(value.toFixed(12))),
  );
});

test('DCT-II and inverse agree with direct formula', () => {
  const input = Float64Array.from([1, 2, -1, 0.5]);
  const transformed = dct(input);
  for (let k = 0; k < input.length; k += 1) {
    const expected =
      2 *
      input.reduce(
        (sum, value, i) =>
          sum + value * Math.cos((Math.PI * (i + 0.5) * k) / input.length),
        0,
      );
    assert.ok(Math.abs(transformed[k] - expected) < 1e-12);
  }
  const recovered = idct(transformed);
  for (let i = 0; i < input.length; i += 1)
    assert.ok(Math.abs(recovered[i] - input[i]) < 1e-12);
});

test('uniform cartogram is identity with positive Jacobian', () => {
  const map = createCartogram({
    width: 8,
    height: 4,
    density: new Float64Array(32).fill(1),
  });
  for (const point of [
    [0, 0],
    [0.25, 0.5],
    [0.75, 0.2],
    [1, 1],
  ]) {
    const mapped = map.forward(...point);
    assert.ok(Math.abs(mapped[0] - point[0]) < 1e-12);
    assert.ok(Math.abs(mapped[1] - point[1]) < 1e-12);
    const recovered = map.inverse(...mapped);
    assert.ok(Math.abs(recovered[0] - point[0]) < 1e-8);
    assert.ok(Math.abs(recovered[1] - point[1]) < 1e-8);
  }
  for (let y = 0.1; y < 1; y += 0.2)
    for (let x = 0.1; x < 1; x += 0.2) assert.ok(map.jacobian(x, y) > 0);
});

test('two-density blocks receive proportional mapped area', () => {
  const width = 16;
  const height = 8;
  const density = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      density[y * width + x] = x < width / 2 ? 2 : 1;
  const map = createCartogram({ width, height, density });
  const left = map.forward(0.5, 0.5)[0];
  assert.ok(Math.abs(left - 2 / 3) < 0.01);
  assert.ok(map.jacobian(0.25, 0.5) > 0);
  assert.ok(map.jacobian(0.75, 0.5) > 0);
});

test('area helpers expose stable signed areas and percentile errors', () => {
  assert.equal(
    polygonSignedArea([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]),
    1,
  );
  assert.equal(areaRelativeError(2, 1), 1);
  const summary = summarizeAreaErrors(
    { a: 1, b: 1.1, c: 0.8 },
    { a: 1, b: 1, c: 1 },
  );
  assert.equal(summary.count, 3);
  assert.ok(Math.abs(summary.median - 0.1) < 1e-12);
  assert.ok(Math.abs(summary.p90 - 0.2) < 1e-12);
  assert.ok(Math.abs(summary.max - 0.2) < 1e-12);
});
