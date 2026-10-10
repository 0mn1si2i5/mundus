import assert from 'node:assert/strict';
import test from 'node:test';
import {
  areaRelativeError,
  composeCartograms,
  computeUnitAreas,
  createCartogram,
  createDiffusionSolver,
  dct,
  densityInMappedSpace,
  fft2d,
  fftRadix2,
  idct,
  ifftRadix2,
  measureRoundTrip,
  measureTriangleOrientation,
  polygonSignedArea,
  rasterizeInverseMap,
  sampleInverseRaster,
  summarizeAreaErrors,
  validateCartogram,
} from './cartogram.mjs';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by ${Math.abs(actual - expected)}`,
  );
}

function naiveDft(values) {
  return Array.from(values, (_, k) => {
    let real = 0;
    let imag = 0;
    for (let i = 0; i < values.length; i += 1) {
      const angle = (-2 * Math.PI * k * i) / values.length;
      real += values[i] * Math.cos(angle);
      imag += values[i] * Math.sin(angle);
    }
    return [real, imag];
  });
}

test('radix-2 FFT agrees with direct DFT and round-trips complex inputs', () => {
  for (const n of [1, 2, 4, 8, 32]) {
    const real = Float64Array.from(
      { length: n },
      (_, i) => Math.sin(1.3 * i) + i / 3,
    );
    const imag = Float64Array.from({ length: n }, (_, i) => Math.cos(0.4 * i));
    const actual = fftRadix2(real);
    const expected = naiveDft(real);
    for (let i = 0; i < n; i += 1) {
      close(actual.real[i], expected[i][0]);
      close(actual.imag[i], expected[i][1]);
      close(ifftRadix2(actual)[i], real[i]);
    }
    const complex = fftRadix2(fftRadix2(real, imag), true);
    for (let i = 0; i < n; i += 1) {
      close(complex.real[i], real[i]);
      close(complex.imag[i], imag[i]);
    }
  }
  assert.throws(() => fftRadix2([1, 2, 3]), /power of two/);
});

test('FFT-backed DCT-II agrees with direct formula and inverse roundtrip', () => {
  for (const n of [1, 2, 4, 8, 32]) {
    const input = Float64Array.from(
      { length: n },
      (_, i) => Math.sin(i * 0.9) - i / 7,
    );
    const actual = dct(input);
    for (let k = 0; k < n; k += 1) {
      const expected =
        2 *
        input.reduce(
          (sum, value, i) =>
            sum + value * Math.cos((Math.PI * (i + 0.5) * k) / n),
          0,
        );
      close(actual[k], expected);
      close(idct(actual)[k], input[k]);
    }
  }
  assert.throws(() => dct([1, 2, 3]), /power of two/);
});

test('2D FFT retains imaginary components on inverse', () => {
  const real = Float64Array.from({ length: 32 }, (_, i) => Math.cos(i));
  const imag = Float64Array.from({ length: 32 }, (_, i) => Math.sin(i));
  const recovered = fft2d(fft2d({ real, imag }, 8, 4), 8, 4, true);
  for (let i = 0; i < real.length; i += 1) {
    close(recovered.real[i], real[i]);
    close(recovered.imag[i], imag[i]);
  }
});

test('mixed FFT/DCT heat evolution and both gradients match an analytic eigenmode', () => {
  const width = 16;
  const height = 8;
  const time = 0.15;
  const density = Float64Array.from({ length: width * height }, (_, i) => {
    const theta = (2 * Math.PI * ((i % width) + 0.5)) / width;
    const phi = (Math.PI * (Math.floor(i / width) + 0.5)) / height;
    return 2 * (1 + 0.3 * Math.cos(theta) * Math.cos(phi));
  });
  const solver = createDiffusionSolver({
    width,
    height,
    density,
    blurSigma: 0,
  });
  const field = solver.evaluate(time);
  const amplitude = 0.3 * Math.exp(-(1 + Math.PI ** 2 / 4) * time);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const theta = (2 * Math.PI * (x + 0.5)) / width;
      const phi = (Math.PI * (y + 0.5)) / height;
      const rho = 1 + amplitude * Math.cos(theta) * Math.cos(phi);
      const i = y * width + x;
      close(field.rho[i], rho, 1e-12);
      close(
        field.vx[i],
        (amplitude * Math.sin(theta) * Math.cos(phi)) / (2 * Math.PI * rho),
        1e-12,
      );
      close(
        field.vy[i],
        (amplitude * Math.PI * Math.cos(theta) * Math.sin(phi)) / (4 * rho),
        1e-12,
      );
    }
  assert.ok(solver.evaluate(1).maxSpeed < field.maxSpeed);
});

test('uniform density remains identity and every mesh triangle has positive area', () => {
  const map = createCartogram({
    width: 8,
    height: 4,
    density: new Float64Array(32).fill(1),
  });
  assert.equal(map.diagnostics.acceptedSteps, 0);
  for (const point of [
    [0, 0],
    [0.25, 0.5],
    [0.75, 0.2],
    [1, 1],
    [-0.2, 0.4],
    [1.2, 0.4],
  ]) {
    const mapped = map.forward(...point);
    close(mapped[0], point[0], 1e-12);
    close(mapped[1], point[1], 1e-12);
    const recovered = map.inverse(...mapped);
    close(recovered[0], point[0]);
    close(recovered[1], point[1]);
  }
  const orientation = measureTriangleOrientation(map);
  assert.equal(orientation.triangles, 64);
  assert.equal(orientation.nonPositive, 0);
  close(orientation.totalAreaSteradians, 4 * Math.PI, 1e-12);
});

test('two density blocks reach target 2:1 area within 2%, with periodic continuity', () => {
  const width = 64;
  const height = 32;
  const density = Float64Array.from({ length: width * height }, (_, i) =>
    i % width < width / 2 ? 2 : 1,
  );
  const ids = Uint8Array.from(density, (value) => (value === 2 ? 1 : 2));
  const map = createCartogram({ width, height, density });
  const areas = computeUnitAreas(map, ids);
  assert.ok(areaRelativeError(areas.get(1) / areas.get(2), 2) < 0.02);
  assert.ok(map.diagnostics.acceptedSteps > 0);
  assert.equal(map.diagnostics.algorithm, 'spectral-diffusion-flow');
  for (let y = 0; y <= height; y += 1) {
    const left = map.forward(0, y / height);
    const right = map.forward(1, y / height);
    close(right[0] - left[0], 1, 1e-12);
    close(right[1], left[1], 1e-12);
    const beforeSeam = map.forward(1 - 1e-8, y / height);
    const afterSeam = map.forward(1e-8, y / height);
    assert.ok(Math.abs(beforeSeam[0] - afterSeam[0] - 1) < 1e-7);
  }
  const report = validateCartogram(map, {
    unitIds: ids,
    targetAreas: new Map([
      [1, 2 / 3],
      [2, 1 / 3],
    ]),
  });
  assert.equal(report.passes, true);
  assert.ok(report.orientation.minimum > 0);
  assert.ok(report.orientation.totalAreaRelativeError < 1e-6);
  assert.ok(report.roundTrip.p999Degrees < 0.05);
  assert.ok(report.roundTrip.maxDegrees < 0.5);
});

test('two-dimensional flow inverts via both triangles without holes or folded mesh', () => {
  const width = 64;
  const height = 32;
  const density = Float64Array.from({ length: width * height }, (_, i) => {
    const x = ((i % width) + 0.5) / width;
    const y = (Math.floor(i / width) + 0.5) / height;
    return 1 + 0.7 * Math.sin(2 * Math.PI * x) * Math.cos(Math.PI * y);
  });
  const map = createCartogram({ width, height, density });
  const orientation = measureTriangleOrientation(map);
  assert.equal(orientation.nonPositive, 0);
  assert.ok(orientation.totalAreaRelativeError < 1e-6);
  const inverse = rasterizeInverseMap(map, { width: 64, height: 32 });
  assert.equal(inverse.missingSamples, 0);
  for (let y = 0; y < inverse.height; y += 1)
    for (let x = 0; x < inverse.width; x += 1) {
      const i = (y * inverse.width + x) * 2;
      const recovered = map.forward(inverse.grid[i], inverse.grid[i + 1]);
      close(recovered[0], (x + 0.5) / inverse.width);
      close(recovered[1], (y + 0.5) / inverse.height);
    }
  const roundTrip = measureRoundTrip(map);
  assert.ok(roundTrip.maxDegrees < 1e-6);
  // The country transport contract is 512x256. A coarse inverse raster
  // cannot represent all changes of inverse slope across source triangles.
  const transport = rasterizeInverseMap(map, {
    width: 512,
    height: 256,
    centers: false,
  });
  const transportRoundTrip = measureRoundTrip(map, (x, y) =>
    sampleInverseRaster(transport, x, y),
  );
  assert.ok(transportRoundTrip.p999Degrees < 0.05);
  assert.ok(transportRoundTrip.maxDegrees < 0.5);
  for (const y of [0, 1]) close(sampleInverseRaster(inverse, 0.3, y)[1], y);
});

test('adaptive integration rejects a large predictor step and convergence is bounded', () => {
  const density = Float64Array.from(
    { length: 16 * 8 },
    (_, i) => 1 + 0.6 * Math.sin((2 * Math.PI * (i % 16)) / 16),
  );
  const map = createCartogram({
    width: 16,
    height: 8,
    density,
    initialStep: 1,
  });
  assert.ok(map.diagnostics.rejectedSteps > 0);
  assert.equal(measureTriangleOrientation(map).positive, true);
  assert.throws(
    () => createCartogram({ width: 16, height: 8, density, maxSteps: 1 }),
    /failed to converge/,
  );
});

test('invalid inputs and non-positive spectral densities fail visibly', () => {
  const width = 64;
  const height = 32;
  const density = Float64Array.from({ length: width * height }, (_, i) =>
    i % width >= 24 &&
    i % width < 40 &&
    Math.floor(i / width) >= 12 &&
    Math.floor(i / width) < 20
      ? 100
      : 1,
  );
  assert.throws(
    () => createCartogram({ width, height, density }),
    /non-positive.*increase blur/,
  );
  assert.throws(
    () => createCartogram({ width, height, density, initialStep: 0 }),
    /tolerance or step budget/,
  );
  assert.throws(
    () =>
      createDiffusionSolver({ width, height, density, domainWidth: Infinity }),
    /invalid diffusion/,
  );
  assert.throws(
    () =>
      createCartogram({
        width,
        height,
        density: new Float64Array(width * height),
      }),
    /positive mass/,
  );
  assert.throws(
    () =>
      createCartogram({
        width,
        height,
        density: Float64Array.from(density, (value, i) =>
          i === 0 ? NaN : value,
        ),
      }),
    /finite and non-negative/,
  );
});

test('composition applies correction in mapped space and remapped density conserves mass', () => {
  const width = 16;
  const height = 8;
  const density = Float64Array.from(
    { length: width * height },
    (_, i) => 1 + 0.3 * Math.sin((2 * Math.PI * (i % width)) / width),
  );
  const first = createCartogram({ width, height, density });
  const remapped = densityInMappedSpace(first, density);
  close(
    remapped.density.reduce((a, b) => a + b, 0),
    density.reduce((a, b) => a + b, 0),
    1e-9,
  );
  assert.ok(remapped.quadratureRelativeError < 0.1);
  const correction = createCartogram({
    width,
    height,
    density: remapped.density,
    blurSigma: 0.25,
  });
  const composite = composeCartograms(first, correction);
  assert.equal(composite.iterations, 2);
  assert.equal(measureTriangleOrientation(composite).positive, true);
  const point = first.forward(0.25, 0.5);
  const expected = correction.forward(...point);
  const actual = composite.forward(0.25, 0.5);
  close(actual[0], expected[0]);
  close(actual[1], expected[1]);
});

test('same input produces byte-identical flow and inverse arrays', () => {
  const density = Float64Array.from(
    { length: 16 * 8 },
    (_, i) => 2 + Math.cos(i % 16),
  );
  const build = () => createCartogram({ width: 16, height: 8, density });
  const first = build();
  const second = build();
  assert.deepEqual(
    new Uint8Array(first.forwardGrid.buffer),
    new Uint8Array(second.forwardGrid.buffer),
  );
  assert.deepEqual(
    new Uint8Array(rasterizeInverseMap(first).grid.buffer),
    new Uint8Array(rasterizeInverseMap(second).grid.buffer),
  );
});

test('area helpers retain signed areas and fail missing expected regions', () => {
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
  close(summary.median, 0.1);
  close(summary.p90, 0.2);
  close(summary.max, 0.2);
  assert.equal(summarizeAreaErrors({ a: 1 }, { a: 1, b: 1 }).max, Infinity);
  assert.equal(
    summarizeAreaErrors(
      { a: 1 },
      { a: 1, b: 1 },
      { minimumShare: 0.01, shares: { a: 1, b: 0.001 } },
    ).count,
    1,
  );
});
