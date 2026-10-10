import assert from 'node:assert/strict';
import test from 'node:test';
import { cartogramFromForwardGrid } from './cartogram.mjs';
import {
  angularErrorDegrees,
  chooseInverseCandidate,
  encodeInverseField,
  measureDisplayRoundTrip,
  QUANTIZATION_CHOICES,
} from './inverse-encoding.mjs';
import { decodeInverse } from '../../src/features/reshaped/inverseFormat.mjs';
import {
  sampleInverseCoordinates,
  sampleInverseDisplacement,
  inverseTextureBytes,
} from '../../src/features/reshaped/inverseSampling.mjs';

const asBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('MRE3 production grid preserves a smooth periodic map and reflecting poles', async () => {
  const width = 32,
    height = 16;
  const grid = new Float64Array((width + 1) * (height + 1) * 2);
  for (let y = 0; y <= height; y += 1)
    for (let x = 0; x <= width; x += 1) {
      const i = (y * (width + 1) + x) * 2;
      grid[i] =
        x / width +
        0.02 *
          Math.sin((2 * Math.PI * x) / width) *
          Math.sin((Math.PI * y) / height);
      grid[i + 1] = y / height;
    }
  const map = cartogramFromForwardGrid({ width, height, forwardGrid: grid });
  const encoded = await encodeInverseField(map, { metric: 'gdp' });
  const field = await decodeInverse(asBuffer(encoded.bytes), { metric: 'gdp' });
  assert.equal(encoded.header.formatVersion, 3);
  assert.equal(field.width, 1024);
  assert.equal(field.height, 512);
  assert.equal(inverseTextureBytes(field), 1025 * 513 * 8);
  assert.equal(encoded.selection.candidates.length, 15);
  assert.equal(encoded.roundTrip.samples, 400_000);
  assert.ok(encoded.quantizationMaxDegrees < 0.01);
  assert.ok(encoded.roundTrip.p99Degrees <= 0.1);
  assert.ok(encoded.roundTrip.p999Degrees <= 0.5);
  assert.ok(encoded.encodedBytes <= 1_200_000);
  assert.ok(encoded.gzipBytes <= 700_000);
  for (const y of [0, 0.1, 0.5, 0.9, 1]) {
    assert.deepEqual(
      sampleInverseDisplacement(field, -0.0001, y),
      sampleInverseDisplacement(field, 0.9999, y),
    );
    for (const x of [0, 0.37, 0.99]) {
      assert.equal(sampleInverseDisplacement(field, x, 0)[1], 0);
      assert.equal(sampleInverseDisplacement(field, x, 1)[1], 0);
    }
  }
  assert.ok(
    angularErrorDegrees(
      map.forward(...sampleInverseCoordinates(field, 0.4, 0.5)),
      [0.4, 0.5],
    ) < 0.01,
  );
});

test('selection minimizes gzip only among candidates meeting every scientific and file bound', () => {
  assert.equal(QUANTIZATION_CHOICES.length, 15);
  const good = {
    stepLongitudeFactor: 2,
    stepSFactor: 1,
    encodedBytes: 800000,
    gzipBytes: 450000,
    quantizationMaxDegrees: 0.009,
    roundTrip: { p99Degrees: 0.09, p999Degrees: 0.49 },
  };
  const smaller = { ...good, gzipBytes: 430000, stepLongitudeFactor: 4 };
  const rejected = [
    { ...good, gzipBytes: 1, quantizationMaxDegrees: 0.01 },
    {
      ...good,
      gzipBytes: 1,
      roundTrip: { p99Degrees: 0.101, p999Degrees: 0.1 },
    },
    {
      ...good,
      gzipBytes: 1,
      roundTrip: { p99Degrees: 0.01, p999Degrees: 0.501 },
    },
    { ...good, encodedBytes: 1200001, gzipBytes: 1 },
    { ...good, gzipBytes: 700001 },
  ];
  assert.equal(chooseInverseCandidate([...rejected, good, smaller]), smaller);
  assert.equal(chooseInverseCandidate(rejected), undefined);
});

test('equal-area display-space measurement has the known 90 degree answer and repeatable seed', () => {
  const identity = { width: 1, height: 1, data: new Float32Array(8) };
  const map = { forward: (x) => [x + 0.25, 0.5] };
  const measured = measureDisplayRoundTrip(map, identity, {
    samples: 1000,
    seed: 17,
  });
  for (const key of ['p50Degrees', 'p99Degrees', 'p999Degrees', 'maxDegrees'])
    assert.ok(Math.abs(measured[key] - 90) < 1e-10);
  assert.deepEqual(
    measured,
    measureDisplayRoundTrip(map, identity, { samples: 1000, seed: 17 }),
  );
  assert.equal(angularErrorDegrees([0, 0.5], [1, 0.5]), 0);
  assert.equal(angularErrorDegrees([0, 1], [0.7, 1]) < 1e-12, true);
});
