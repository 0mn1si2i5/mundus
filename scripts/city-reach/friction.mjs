import { createHash } from 'node:crypto';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function pixelSha256(values) {
  // Canonical decoded float32 little-endian identity, independent of TIFF metadata.
  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(65_536);
  for (let start = 0; start < values.length; start += chunk.length / 4) {
    const count = Math.min(chunk.length / 4, values.length - start);
    for (let offset = 0; offset < count; offset += 1) {
      chunk.writeFloatLE(Number(values[start + offset]), offset * 4);
    }
    hash.update(chunk.subarray(0, count * 4));
  }
  return hash.digest('hex');
}

export function aggregateFriction(values, width, height, factor = 4) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width % factor ||
    height % factor ||
    values.length !== width * height
  ) {
    throw new Error(
      'MAP tile dimensions must be positive multiples of the aggregation factor',
    );
  }
  const coarseWidth = width / factor;
  const coarseHeight = height / factor;
  const friction = new Float32Array(coarseWidth * coarseHeight).fill(NaN);
  const land = new Uint8Array(friction.length);
  const landFraction = new Float32Array(friction.length);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const value = values[row * width + column];
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        Math.abs(value - 0.00316) <= 2e-6
      )
        continue;
      const target =
        Math.floor(row / factor) * coarseWidth + Math.floor(column / factor);
      friction[target] = land[target]
        ? Math.min(friction[target], value)
        : value;
      land[target] = 1;
      landFraction[target] += 1 / (factor * factor);
    }
  }
  return {
    width: coarseWidth,
    height: coarseHeight,
    friction,
    land,
    landFraction,
  };
}

export function packFineLand(values) {
  const result = Buffer.alloc(Math.ceil(values.length / 8));
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (Number.isFinite(value) && value > 0 && Math.abs(value - 0.00316) > 2e-6)
      result[index >> 3] |= 1 << (index & 7);
  }
  return result;
}

export async function decodeMapTiff(bytes, request) {
  const { fromArrayBuffer } = await import('geotiff');
  const tiff = await fromArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const bounds = request.bounds;
  if (
    Math.abs((east - west) / width - 1 / 120) > 1e-9 ||
    Math.abs((north - south) / height - 1 / 120) > 1e-9 ||
    Math.abs(west - bounds.west) > 1e-7 ||
    Math.abs(east - bounds.east) > 1e-7 ||
    Math.abs(north - bounds.north) > 1e-7 ||
    Math.abs(south - bounds.south) > 1e-7
  ) {
    throw new Error(`Unexpected MAP resolution or bounds for ${request.id}`);
  }
  const values = await image.readRasters({ samples: [0], interleave: true });
  return { width, height, values };
}

export function verifyMapIdentity(identity, expected) {
  if (
    !expected ||
    expected.url !== identity.url ||
    expected.hashKind !== identity.hashKind ||
    expected.sha256 !== identity.sha256 ||
    expected.width !== identity.width ||
    expected.height !== identity.height
  ) {
    throw new Error(
      `MAP source identity mismatch for ${identity.id}: expected ${expected?.sha256 ?? 'no pinned identity'}, received ${identity.sha256}`,
    );
  }
}
