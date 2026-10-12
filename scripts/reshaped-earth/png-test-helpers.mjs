import { decodePngRgb } from '../../src/features/reshaped/pngCore.mjs';

/**
 * Decode the published RGB bytes through the same browser decoder used at
 * runtime, expanding its packed 24-bit IDs for build-side assertions.
 */
export async function decodeRgbPng(input) {
  const bytes =
    input instanceof Uint8Array ? input : Uint8Array.from(input ?? []);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const decoded = await decodePngRgb(buffer);
  const data = new Uint8Array(decoded.ids.length * 3);
  for (let i = 0; i < decoded.ids.length; i += 1) {
    const id = decoded.ids[i];
    data[i * 3] = id >>> 16;
    data[i * 3 + 1] = (id >>> 8) & 255;
    data[i * 3 + 2] = id & 255;
  }
  return { width: decoded.width, height: decoded.height, data };
}
