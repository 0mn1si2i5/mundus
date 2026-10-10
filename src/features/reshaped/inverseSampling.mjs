const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = (value, period) => ((value % period) + period) % period;
export const wrapDisplacementLongitude = (value) =>
  wrap(value + 180, 360) - 180;

/** Node-aligned bilinear interpolation; the GLSL sampler uses these conventions. */
export function sampleInverseDisplacement(field, x, y) {
  if (!field) return [0, 0];
  const { width, height, data } = field;
  const sx = wrap(x, 1) * width,
    sy = clamp(y, 0, 1) * height;
  const col = Math.min(width - 1, Math.floor(sx)),
    row = Math.min(height - 1, Math.floor(sy));
  const tx = sx - col,
    ty = sy - row,
    cols = width + 1;
  const a = (row * cols + col) * 2;
  const indices = [a, a + 2, a + cols * 2, a + cols * 2 + 2];
  const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  const base = data[a];
  let longitude = 0,
    s = 0;
  for (let i = 0; i < 4; i += 1) {
    longitude +=
      (base + wrapDisplacementLongitude(data[indices[i]] - base)) * weights[i];
    s += data[indices[i] + 1] * weights[i];
  }
  return [longitude, s === 0 ? 0 : s];
}
export function sampleInverseCoordinates(field, x, y) {
  const [longitude, s] = sampleInverseDisplacement(field, x, y);
  return [x + longitude / 360, clamp(y + s / 2, 0, 1)];
}
export function sampleInverseLatitude(field, x, latitude) {
  const y = (Math.sin((latitude * Math.PI) / 180) + 1) / 2;
  const point = sampleInverseCoordinates(field, x, y);
  return [
    point[0],
    (Math.asin(clamp(2 * point[1] - 1, -1, 1)) * 180) / Math.PI,
  ];
}
/** Stable sine-latitude morph at reflecting poles. Angles are degrees. */
export function morphLatitude(from, to, t) {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const a = (from * Math.PI) / 180,
    b = (to * Math.PI) / 180;
  const north = (1 - t) * Math.sin(a) + t * Math.sin(b) >= 0;
  const pole = north ? Math.PI / 2 : -Math.PI / 2;
  const distance = Math.sqrt(
    (1 - t) * Math.sin((pole - a) / 2) ** 2 + t * Math.sin((pole - b) / 2) ** 2,
  );
  return (
    ((pole + (north ? -2 : 2) * Math.asin(clamp(distance, 0, 1))) * 180) /
    Math.PI
  );
}
export function inverseTextureBytes(field) {
  return (field.width + 1) * (field.height + 1) * 8;
}
export const inverseTextureBytesFromDescriptor = inverseTextureBytes;
export function reshapedMorphTextureBytes(
  fromBytes,
  toBytes,
  maxRasterId,
  width = 4096,
  height = 2048,
) {
  const paletteBytes = Math.ceil((maxRasterId + 1) / 256) * 256 * 16;
  return fromBytes + toBytes + width * height * 2 + paletteBytes;
}
