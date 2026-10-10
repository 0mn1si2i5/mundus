import assert from 'node:assert/strict';
import test from 'node:test';
import { createCartogram } from './cartogram.mjs';
import { encodeInverseField } from './inverse-encoding.mjs';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { decodeInverse } from '../../src/features/reshaped/inverseFormat.mjs';
import {
  sampleInverseCoordinates,
  sampleInverseDisplacement,
  inverseTextureBytes,
  measureAdaptiveEdgeContinuity,
} from '../../src/features/reshaped/inverseSampling.mjs';

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
    encoding: 'regular',
  });
  const second = await encodeInverseField(map, {
    metric: 'population',
    level: 'country',
    encoding: 'regular',
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
  for (const encoding of ['regular', 'adaptive']) {
    const field = await encodeInverseField(map, {
      metric: 'gdp',
      level: 'country',
      encoding,
    });
    assert.ok(
      field.quantizationMaxDegrees < 0.01,
      JSON.stringify(field.header),
    );
    assert.ok(
      field.roundTrip.p999Degrees < 0.05,
      JSON.stringify(field.roundTrip),
    );
    assert.ok(field.roundTrip.maxDegrees < 0.5);
  }
});

const asBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const expected = { metric: 'population', level: 'country' };

test('adaptive identity is deterministic, compact, periodic and preserves both poles', async () => {
  const map = {
    width: 16,
    height: 8,
    forward: (x, y) => [x, y],
    inverse: (x, y) => [x, y],
  };
  const first = await encodeInverseField(map, expected);
  const second = await encodeInverseField(map, expected);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.header.formatVersion, 2);
  assert.equal(first.header.verticalCoordinate, 'latitude');
  assert.ok(first.header.stepLatitude > 0);
  assert.equal(first.header.stepS, undefined);
  assert.equal(first.header.leafCount, 128 * 64);
  assert.equal(first.roundTrip.maxDegrees, 0);
  assert.equal(first.quantizationMaxDegrees, 0);
  assert.ok(first.bytes.length < 10_000);
  const field = await decodeInverse(asBuffer(first.bytes), expected);
  for (const x of [-1, -0.001, 0, 0.999, 1, 3])
    for (const y of [0, 0.01, 0.5, 0.99, 1])
      assert.deepEqual(sampleInverseCoordinates(field, x, y), [x, y]);
  assert.equal(inverseTextureBytes(field), 128 * 64 * 20 + 8);
});

test('adaptive inverse refines a local steep field and validates every source node', async () => {
  const offset = (x, y) =>
    0.025 * Math.sin(2 * Math.PI * x) * Math.exp(-(((y - 0.5) / 0.055) ** 2));
  const map = {
    width: 64,
    height: 32,
    forward: (x, y) => [x + offset(x, y), y],
    inverse(x, y) {
      let source = x;
      for (let n = 0; n < 20; n += 1)
        source -=
          (source + offset(source, y) - x) /
          (1 +
            0.025 *
              2 *
              Math.PI *
              Math.cos(2 * Math.PI * source) *
              Math.exp(-(((y - 0.5) / 0.055) ** 2)));
      return [source, y];
    },
  };
  const encoded = await encodeInverseField(map, {
    ...expected,
    rootWidth: 4,
    maxDepth: 7,
  });
  assert.ok(encoded.header.leafCount > 8);
  assert.ok(encoded.header.leafCount < (8 * 4 ** 7) / 8);
  assert.ok(
    encoded.roundTrip.p999Degrees < 0.05,
    JSON.stringify(encoded.roundTrip),
  );
  assert.ok(encoded.roundTrip.maxDegrees < 0.5);
  assert.ok(encoded.quantizationMaxDegrees < 0.01);
  assert.equal(encoded.diagnostics.edgeContinuity.balanced, true);
  assert.ok(encoded.diagnostics.unquantizedEdges.maxDegrees < 1e-9);
  assert.ok(encoded.edgeJumpMaxDegrees < 0.01);
  const field = await decodeInverse(asBuffer(encoded.bytes), expected);
  const seamA = sampleInverseDisplacement(field, -0.00001, 0.5);
  const seamB = sampleInverseDisplacement(field, 0.99999, 0.5);
  assert.ok(Math.abs(seamA[0] - seamB[0]) < 1e-7);
  assert.ok(Math.abs(seamA[1] - seamB[1]) < 1e-7);
  assert.equal(sampleInverseDisplacement(field, 0.4, 0)[1], 0);
  assert.equal(sampleInverseDisplacement(field, 0.4, 1)[1], 0);
  field.corners[0] += 10000;
  assert.ok(measureAdaptiveEdgeContinuity(field).maxDegrees > 0.01);
});

async function adaptivePacket(tree, corners, overrides = {}) {
  await MeshoptEncoder.ready;
  const treeBytes = Buffer.alloc(tree.length * 4),
    cornerBytes = Buffer.alloc(corners.length * 2);
  tree.forEach((word, index) => treeBytes.writeUInt32LE(word, index * 4));
  corners.forEach((word, index) => cornerBytes.writeInt16LE(word, index * 2));
  const t = MeshoptEncoder.encodeVertexBuffer(treeBytes, tree.length, 4);
  const c = MeshoptEncoder.encodeVertexBuffer(
    cornerBytes,
    corners.length / 2,
    4,
  );
  const header = Buffer.from(
    JSON.stringify({
      formatVersion: 2,
      encoding: 'adaptive-quadtree-int16',
      width: 1,
      height: 1,
      maxDepth: 1,
      metric: 'population',
      level: 'country',
      stride: 4,
      treeNodes: tree.length,
      leafCount: corners.length / 8,
      stepLongitude: 0.001,
      stepS: 0.00001,
      encodedBytes: t.length + c.length,
      treeEncodedBytes: t.length,
      cornerEncodedBytes: c.length,
      ...overrides,
    }),
  );
  const prefix = Buffer.alloc(8);
  prefix.write('MRE2');
  prefix.writeUInt32LE(header.length, 4);
  return asBuffer(Buffer.concat([prefix, header, t, c]));
}

test('adaptive decoder rejects invalid depth, quantization, children, leaves and poles', async () => {
  for (const overrides of [
    { maxDepth: 9 },
    { stepS: 0 },
    { stepLongitude: NaN },
    { treeEncodedBytes: -1 },
    { formatVersion: 1 },
  ])
    await assert.rejects(
      decodeInverse(
        await adaptivePacket([0x80000000], new Array(8).fill(0), overrides),
        expected,
      ),
    );
  const branches = [1, 0x80000000, 0x80000001, 0x80000002, 0x80000003];
  for (const tree of [
    [100, ...branches.slice(1)],
    [1, 0x80000007, ...branches.slice(2)],
    [1, 0x80000000, 0x80000000, ...branches.slice(3)],
    [1, 1, ...branches.slice(2)],
  ])
    await assert.rejects(
      decodeInverse(
        await adaptivePacket(tree, new Array(32).fill(0)),
        expected,
      ),
    );
  const polar = new Array(8).fill(0);
  polar[1] = 1;
  await assert.rejects(
    decodeInverse(await adaptivePacket([0x80000000], polar), expected),
    /pole/,
  );
  await assert.rejects(
    decodeInverse(
      await adaptivePacket(branches, new Array(32).fill(0), { maxDepth: 0 }),
      expected,
    ),
    /child/,
  );
});

test('latitude leaves retain angular detail when a polar band is strongly compressed', async () => {
  const map = {
    width: 256,
    height: 128,
    forward: (x, y) => [x, 1 - (1 - y) ** 3],
    inverse: (x, y) => [x, 1 - Math.cbrt(1 - y)],
  };
  const encoded = await encodeInverseField(map, expected);
  assert.ok(
    encoded.roundTrip.p999Degrees < 0.05,
    JSON.stringify(encoded.roundTrip),
  );
  assert.ok(encoded.roundTrip.maxDegrees < 0.5);
  assert.ok(encoded.quantizationMaxDegrees < 0.01);
  assert.ok(encoded.edgeJumpMaxDegrees < 0.01);
  assert.equal(encoded.diagnostics.edgeContinuity.balanced, true);
});
