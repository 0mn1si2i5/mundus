import { MeshoptDecoder } from 'meshoptimizer/decoder';

const MAGIC = 'MRE3';
const FORMAT_VERSION = 3;
const ENCODING = 'regular-node-int16';
const STRIDE = 4;
// Typed-array integer reads use the host byte order. Browsers and Node run on
// little-endian machines today, but keep the DataView path for portability so
// the on-disk little-endian format remains unambiguous.
const HOST_LITTLE_ENDIAN =
  new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 0x02;
export const INVERSE_GRID = Object.freeze({ width: 1024, height: 512 });

let meshoptWorkerEnabled = false;

async function decodePayload(source, count) {
  await MeshoptDecoder.ready;
  if (
    typeof Worker === 'function' &&
    typeof MeshoptDecoder.useWorkers === 'function' &&
    typeof MeshoptDecoder.decodeGltfBufferAsync === 'function'
  ) {
    try {
      if (!meshoptWorkerEnabled) {
        MeshoptDecoder.useWorkers(1);
        meshoptWorkerEnabled = true;
      }
      return await MeshoptDecoder.decodeGltfBufferAsync(
        count,
        STRIDE,
        source,
        'ATTRIBUTES',
      );
    } catch {
      // A restricted browser may reject a Blob worker. Keep the verified
      // synchronous decoder as a portable fallback for that environment.
      meshoptWorkerEnabled = false;
    }
  }
  const decoded = new Uint8Array(count * STRIDE);
  MeshoptDecoder.decodeVertexBuffer(decoded, count, STRIDE, source);
  return decoded;
}

/** Envelope shared by the offline encoder and runtime decoder. */
export function encodeInversePacket(payload, { metric, stepLongitude, stepS }) {
  const header = {
    formatVersion: FORMAT_VERSION,
    encoding: ENCODING,
    width: INVERSE_GRID.width,
    height: INVERSE_GRID.height,
    stepLongitude,
    stepS,
    metric,
    stride: STRIDE,
    encodedBytes: payload.length,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(8 + json.length + payload.length);
  bytes.set(new TextEncoder().encode(MAGIC));
  new DataView(bytes.buffer).setUint32(4, json.length, true);
  bytes.set(json, 8);
  bytes.set(payload, 8 + json.length);
  return { header, bytes };
}

/** MRE3: periodic equal-area nodes, Int16 longitude/sine-latitude deltas. */
export async function decodeInverse(buffer, expected) {
  if (buffer.byteLength < 8 || buffer.byteLength > 1_200_000)
    throw new Error('Invalid cartogram file length');
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC)
    throw new Error('Invalid cartogram magic');
  const length = view.getUint32(4, true);
  if (!length || length > 4096 || length + 8 >= bytes.length)
    throw new Error('Invalid cartogram header length');
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  if (
    h.formatVersion !== FORMAT_VERSION ||
    h.encoding !== ENCODING ||
    h.width !== INVERSE_GRID.width ||
    h.height !== INVERSE_GRID.height ||
    h.metric !== expected.metric ||
    !['population', 'gdp', 'co2', 'lights'].includes(h.metric) ||
    h.stride !== STRIDE ||
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
  const decoded = await decodePayload(bytes.subarray(8 + length), count);
  const data = new Float32Array(count * 2);
  if (HOST_LITTLE_ENDIAN) {
    // The decoded buffer is aligned and has an even byte length, so the
    // native Int16 view removes roughly one million DataView calls per field.
    const values = new Int16Array(decoded.buffer, decoded.byteOffset);
    for (let i = 0; i < count; i += 1) {
      const value = i * 2;
      data[value] = values[value] * h.stepLongitude;
      data[value + 1] = values[value + 1] * h.stepS;
    }
  } else {
    const values = new DataView(
      decoded.buffer,
      decoded.byteOffset,
      decoded.byteLength,
    );
    for (let i = 0; i < count; i += 1) {
      const value = i * 2;
      data[value] = values.getInt16(value * 2, true) * h.stepLongitude;
      data[value + 1] = values.getInt16(value * 2 + 2, true) * h.stepS;
    }
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
