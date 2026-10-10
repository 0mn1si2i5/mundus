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
      level: 'country',
    }),
    /magic/,
  );
  const header = Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      width: 1,
      height: 1,
      metric: 'gdp',
      level: 'admin1',
      stride: 4,
      encodedBytes: 1,
      stepLongitude: 0.01,
      stepS: 0.001,
    }),
  );
  const bytes = Buffer.concat([
    Buffer.from('MRE1'),
    Buffer.alloc(4),
    header,
    Buffer.alloc(1),
  ]);
  bytes.writeUInt32LE(header.length, 4);
  await assert.rejects(
    decodeInverse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { metric: 'gdp', level: 'admin1' },
    ),
    /header/,
  );
});
