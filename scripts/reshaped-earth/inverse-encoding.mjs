import { MeshoptEncoder } from 'meshoptimizer/encoder';
import {
  rasterizeInverseMap,
  sampleInverseRaster,
  measureRoundTrip,
} from './cartogram.mjs';
import { decodeInverse } from '../../src/features/reshaped/inverseFormat.mjs';

const wrap = (x) => x - Math.floor(x + 0.5);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function angularErrorDegrees(a, b) {
  const lon = wrap(a[0] - b[0]) * 2 * Math.PI;
  const la = Math.asin(clamp(2 * a[1] - 1, -1, 1));
  const lb = Math.asin(clamp(2 * b[1] - 1, -1, 1));
  const h =
    Math.sin((la - lb) / 2) ** 2 +
    Math.cos(la) * Math.cos(lb) * Math.sin(lon / 2) ** 2;
  return (360 / Math.PI) * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

/** The browser's periodic bilinear sampler, in normalized equal-area coordinates. */
export function sampleEncodedInverse(field, x, y) {
  const { width, height, data } = field;
  const fx = (x - Math.floor(x)) * width - 0.5;
  const fy = clamp(y * height - 0.5, 0, height - 1);
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy),
    tx = fx - x0,
    ty = fy - y0;
  let dx = 0,
    ds = 0,
    base;
  for (let j = 0; j < 2; j += 1)
    for (let i = 0; i < 2; i += 1) {
      const col = (((x0 + i) % width) + width) % width;
      const row = Math.min(height - 1, y0 + j);
      const index = (row * width + col) * 2;
      const weight = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
      base ??= data[index];
      dx += (base + wrap((data[index] - base) / 360) * 360) * weight;
      ds += data[index + 1] * weight;
    }
  ds *= clamp(2 * Math.min(y, 1 - y) * height, 0, 1);
  return [x + dx / 360, clamp(y + ds / 2, 0, 1)];
}

export async function encodeInverseField(map, { metric, level }) {
  const width = level === 'country' ? 512 : 1024,
    height = width / 2;
  const raster = rasterizeInverseMap(map, { width, height, centers: true });
  const count = width * height;
  let maxLongitude = 0,
    maxS = 0;
  const displacements = new Float64Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const x = ((i % width) + 0.5) / width,
      y = (Math.floor(i / width) + 0.5) / height;
    const lon = wrap(raster.grid[i * 2] - x) * 360;
    const ds = (raster.grid[i * 2 + 1] - y) * 2;
    displacements[i * 2] = lon;
    displacements[i * 2 + 1] = ds;
    maxLongitude = Math.max(maxLongitude, Math.abs(lon));
    maxS = Math.max(maxS, Math.abs(ds));
    // Retain the same branch of longitude for the raw acceptance sampler.
    raster.grid[i * 2] = x + lon / 360;
  }
  const stepLongitude = Math.max(maxLongitude / 32767, 1e-9);
  const stepS = Math.max(maxS / 32767, 1e-12);
  const quantized = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i += 1) {
    quantized.writeInt16LE(
      Math.round(displacements[i * 2] / stepLongitude),
      i * 4,
    );
    quantized.writeInt16LE(
      Math.round(displacements[i * 2 + 1] / stepS),
      i * 4 + 2,
    );
  }
  await MeshoptEncoder.ready;
  const encoded = MeshoptEncoder.encodeVertexBuffer(quantized, count, 4);
  const header = {
    formatVersion: 1,
    width,
    height,
    stepLongitude,
    stepS,
    metric,
    level,
    stride: 4,
    encodedBytes: encoded.length,
  };
  const json = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.alloc(8);
  prefix.write('MRE1');
  prefix.writeUInt32LE(json.length, 4);
  const bytes = Buffer.concat([prefix, json, encoded]);
  const decoded = await decodeInverse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { metric, level },
  );
  const sampler = (x, y) => sampleEncodedInverse(decoded, x, y);
  let quantizationMaxDegrees = 0;
  for (let y = 0; y <= map.height; y += 1)
    for (let x = 0; x <= map.width; x += 1) {
      const at = map.forward(x / map.width, y / map.height);
      quantizationMaxDegrees = Math.max(
        quantizationMaxDegrees,
        angularErrorDegrees(sampleInverseRaster(raster, ...at), sampler(...at)),
      );
    }
  for (let i = 0; i < count; i += 1) {
    const x = ((i % width) + 0.5) / width,
      y = (Math.floor(i / width) + 0.5) / height;
    quantizationMaxDegrees = Math.max(
      quantizationMaxDegrees,
      angularErrorDegrees(sampleInverseRaster(raster, x, y), sampler(x, y)),
    );
  }
  return {
    bytes,
    header,
    roundTrip: measureRoundTrip(map, sampler),
    quantizationMaxDegrees,
  };
}
