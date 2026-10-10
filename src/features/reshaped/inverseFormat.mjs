import { MeshoptDecoder } from 'meshoptimizer/decoder';

export async function decodeInverse(buffer, expected) {
  if (buffer.byteLength < 8 || buffer.byteLength > 2_000_000)
    throw new Error('Invalid cartogram file length');
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'MRE1')
    throw new Error('Invalid cartogram magic');
  const length = view.getUint32(4, true);
  if (!length || length > 4096 || length + 8 >= bytes.length)
    throw new Error('Invalid cartogram header length');
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  const width = expected.level === 'country' ? 512 : 1024,
    height = width / 2;
  if (
    h.formatVersion !== 1 ||
    h.width !== width ||
    h.height !== height ||
    h.metric !== expected.metric ||
    h.level !== expected.level ||
    h.stride !== 4 ||
    h.encodedBytes !== bytes.length - 8 - length ||
    !Number.isFinite(h.stepLongitude) ||
    h.stepLongitude <= 0 ||
    h.stepLongitude > 0.02 ||
    !Number.isFinite(h.stepS) ||
    h.stepS <= 0 ||
    h.stepS > 0.001
  )
    throw new Error('Invalid cartogram header');
  await MeshoptDecoder.ready;
  const decoded = new Uint8Array(width * height * 4);
  MeshoptDecoder.decodeVertexBuffer(
    decoded,
    width * height,
    4,
    bytes.subarray(8 + length),
  );
  const values = new DataView(decoded.buffer),
    data = new Float32Array(width * height * 2);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 2] = values.getInt16(i * 4, true) * h.stepLongitude;
    data[i * 2 + 1] = values.getInt16(i * 4 + 2, true) * h.stepS;
  }
  return { width, height, data, header: h };
}
