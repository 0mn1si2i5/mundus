import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeRgbPng } from './png.mjs';
import { decodePngRgb } from '../../src/features/reshaped/pngCore.mjs';
import { decodeInverse } from '../../src/features/reshaped/inverseFormat.mjs';

test('build RGB8 writer roundtrips byte-exact IDs through browser decoder', async () => {
  const png = writeRgbPng(
    2,
    2,
    Uint8Array.from([0, 0, 0, 0, 1, 255, 1, 0, 0, 255, 255, 255]),
  );
  const raster = await decodePngRgb(
    png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  );
  assert.deepEqual([...raster.ids], [0, 511, 65536, 16777215]);
});
test('runtime PNG rejects changed bytes before decoding', async () => {
  const png = writeRgbPng(1, 1, Uint8Array.from([0, 0, 2]));
  png[40] ^= 1;
  await assert.rejects(
    decodePngRgb(
      png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    ),
    /CRC/,
  );
});
test('runtime inverse rejects prototype and inconsistent headers', async () => {
  await assert.rejects(
    decodeInverse(new ArrayBuffer(32), {
      metric: 'population',
    }),
    /magic/,
  );
  const header = Buffer.from(
    JSON.stringify({
      formatVersion: 3,
      encoding: 'regular-node-int16',
      width: 1,
      height: 1,
      metric: 'gdp',
      stride: 4,
      encodedBytes: 1,
      stepLongitude: 0.01,
      stepS: 0.001,
    }),
  );
  const bytes = Buffer.concat([
    Buffer.from('MRE3'),
    Buffer.alloc(4),
    header,
    Buffer.alloc(1),
  ]);
  bytes.writeUInt32LE(header.length, 4);
  await assert.rejects(
    decodeInverse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { metric: 'gdp' },
    ),
    /header/,
  );
});

test('MRE3 decoder rejects a broken periodic seam or moving pole', async () => {
  const { MeshoptEncoder } = await import('meshoptimizer/encoder');
  await MeshoptEncoder.ready;
  const width = 1024,
    height = 512,
    count = (width + 1) * (height + 1);
  const packet = (raw) => {
    const payload = MeshoptEncoder.encodeVertexBuffer(raw, count, 4);
    const header = Buffer.from(
      JSON.stringify({
        formatVersion: 3,
        encoding: 'regular-node-int16',
        width,
        height,
        metric: 'co2',
        stride: 4,
        encodedBytes: payload.length,
        stepLongitude: 0.001,
        stepS: 0.00001,
      }),
    );
    const bytes = Buffer.concat([
      Buffer.from('MRE3'),
      Buffer.alloc(4),
      header,
      payload,
    ]);
    bytes.writeUInt32LE(header.length, 4);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  };
  const seam = Buffer.alloc(count * 4);
  seam.writeInt16LE(1, (width + 1) * 4);
  await assert.rejects(decodeInverse(packet(seam), { metric: 'co2' }), /seam/);
  const pole = Buffer.alloc(count * 4);
  pole.writeInt16LE(1, 6);
  await assert.rejects(decodeInverse(packet(pole), { metric: 'co2' }), /pole/);
});
