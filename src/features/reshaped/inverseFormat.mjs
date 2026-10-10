import { MeshoptDecoder } from 'meshoptimizer/decoder';

/** MRE3: periodic equal-area nodes, Int16 longitude/sine-latitude deltas. */
export async function decodeInverse(buffer, expected) {
  if (buffer.byteLength < 8 || buffer.byteLength > 1_200_000)
    throw new Error('Invalid cartogram file length');
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'MRE3')
    throw new Error('Invalid cartogram magic');
  const length = view.getUint32(4, true);
  if (!length || length > 4096 || length + 8 >= bytes.length)
    throw new Error('Invalid cartogram header length');
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  if (
    h.formatVersion !== 3 ||
    h.encoding !== 'regular-node-int16' ||
    h.width !== 1024 ||
    h.height !== 512 ||
    h.metric !== expected.metric ||
    !['population', 'gdp', 'co2', 'lights'].includes(h.metric) ||
    h.stride !== 4 ||
    h.encodedBytes !== bytes.length - 8 - length ||
    !Number.isFinite(h.stepLongitude) ||
    h.stepLongitude <= 0 ||
    h.stepLongitude > 0.14 ||
    !Number.isFinite(h.stepS) ||
    h.stepS <= 0 ||
    h.stepS > 0.001 ||
    h.level !== undefined
  )
    throw new Error('Invalid cartogram header');
  const count = (h.width + 1) * (h.height + 1);
  await MeshoptDecoder.ready;
  const decoded = new Uint8Array(count * 4);
  MeshoptDecoder.decodeVertexBuffer(
    decoded,
    count,
    4,
    bytes.subarray(8 + length),
  );
  const values = new DataView(decoded.buffer),
    data = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    data[i * 2] = values.getInt16(i * 4, true) * h.stepLongitude;
    data[i * 2 + 1] = values.getInt16(i * 4 + 2, true) * h.stepS;
  }
  for (let y = 0; y <= h.height; y += 1) {
    const a = y * (h.width + 1) * 2,
      b = a + h.width * 2;
    if (data[a] !== data[b] || data[a + 1] !== data[b + 1])
      throw new Error('Invalid cartogram periodic seam');
    if (y === 0 || y === h.height)
      for (let x = 0; x <= h.width; x += 1)
        if (data[a + 2 * x + 1] !== 0)
          throw new Error('Invalid cartogram reflecting pole');
  }
  return {
    width: h.width,
    height: h.height,
    encoding: 'regular-node-float32',
    data,
    header: h,
  };
}
