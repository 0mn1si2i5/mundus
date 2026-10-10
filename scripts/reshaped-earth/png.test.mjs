import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeRgbPng, writeRgbPng } from './png.mjs';

test('RGB PNG writer and decoder round-trip byte-exact IDs', () => {
  const pixels = Uint8Array.from([
    0, 1, 2, 3, 4, 5, 200, 201, 202, 253, 254, 255,
  ]);
  const encoded = writeRgbPng(2, 2, pixels);
  const decoded = decodeRgbPng(encoded);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  assert.deepEqual(decoded.data, pixels);
  // The constrained writer has only the PNG signature and IHDR/IDAT/IEND.
  assert.equal(Buffer.from(encoded).includes(Buffer.from('gAMA')), false);
  assert.equal(Buffer.from(encoded).includes(Buffer.from('sRGB')), false);
});

test('decoder rejects non-RGB and malformed PNG input', () => {
  assert.throws(() => decodeRgbPng(Uint8Array.of(1, 2, 3)), /signature/i);
  const encoded = writeRgbPng(1, 1, Uint8Array.of(1, 2, 3));
  const corrupted = Uint8Array.from(encoded);
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => decodeRgbPng(corrupted), /CRC|IEND/i);
});
