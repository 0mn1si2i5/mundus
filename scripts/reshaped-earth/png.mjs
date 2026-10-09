import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.from(data);
  const output = Buffer.allocUnsafe(12 + payload.length);
  output.writeUInt32BE(payload.length, 0);
  typeBytes.copy(output, 4);
  payload.copy(output, 8);
  output.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, payload])),
    8 + payload.length,
  );
  return output;
}

function asRgbBytes(data, width, height) {
  if (
    !data ||
    typeof data.length !== 'number' ||
    data.length !== width * height * 3
  ) {
    throw new RangeError(
      `RGB data must contain exactly ${width * height * 3} bytes`,
    );
  }
  return Buffer.from(data);
}

/** Encode an 8-bit, non-interlaced RGB PNG with no ancillary colour chunks. */
export function writeRgbPng(width, height, data) {
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    height < 1
  ) {
    throw new RangeError('PNG width and height must be positive integers');
  }
  const rgb = asRgbBytes(data, width, height);
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  const stride = width * 3;
  for (let y = 0; y < height; y += 1) {
    // Filter 0 is intentional: IDs are opaque bytes, and the decoder remains
    // straightforward and deterministic across Node and browser builds.
    scanlines[y * (stride + 1)] = 0;
    rgb.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function readChunkBytes(bytes, offset, length) {
  if (offset + length > bytes.length)
    throw new Error('PNG chunk exceeds input length');
  return bytes.subarray(offset, offset + length);
}

/**
 * Decode the constrained RGB PNG format emitted by writeRgbPng.  The parser
 * accepts all five PNG row filters so fixtures made by other compliant tools
 * remain useful, but rejects palette, alpha, interlaced and colour-management
 * variants because IDs must remain byte exact.
 */
export function decodeRgbPng(input) {
  const bytes =
    input instanceof Uint8Array ? input : Uint8Array.from(input ?? []);
  if (
    bytes.length < 33 ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    throw new Error('Invalid PNG signature');
  }
  let offset = 8;
  let width;
  let height;
  let idat = [];
  let sawIend = false;
  while (offset < bytes.length) {
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      4,
    ).getUint32(0);
    const typeBytes = readChunkBytes(bytes, offset + 4, 4);
    const type = String.fromCharCode(...typeBytes);
    const payload = readChunkBytes(bytes, offset + 8, length);
    const crcOffset = offset + 8 + length;
    const storedCrc = new DataView(
      bytes.buffer,
      bytes.byteOffset + crcOffset,
      4,
    ).getUint32(0);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (storedCrc !== actualCrc) throw new Error(`PNG CRC mismatch in ${type}`);
    offset = crcOffset + 4;
    if (type === 'IHDR') {
      if (width !== undefined || length !== 13)
        throw new Error('PNG must contain exactly one IHDR');
      const view = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength,
      );
      width = view.getUint32(0);
      height = view.getUint32(4);
      if (
        !width ||
        !height ||
        payload[8] !== 8 ||
        payload[9] !== 2 ||
        payload[10] !== 0 ||
        payload[11] !== 0 ||
        payload[12] !== 0
      ) {
        throw new Error('Only 8-bit RGB non-interlaced PNGs are supported');
      }
    } else if (type === 'IDAT') {
      idat.push(payload);
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('Invalid PNG IEND');
      sawIend = true;
      break;
    } else {
      // No gAMA/sRGB/iCCP or other chunks are needed for ID rasters.  Reject
      // them to prevent a browser colour-management path from changing IDs.
      throw new Error(`Unsupported PNG chunk: ${type}`);
    }
  }
  if (width === undefined || !idat.length || !sawIend)
    throw new Error('Incomplete PNG');
  const scanlineStride = width * 3 + 1;
  const expectedLength = scanlineStride * height;
  const inflated = inflateSync(Buffer.concat(idat));
  if (inflated.length !== expectedLength)
    throw new Error('PNG decompressed length mismatch');
  const rgb = new Uint8Array(width * height * 3);
  let previous = new Uint8Array(width * 3);
  for (let y = 0; y < height; y += 1) {
    const inputOffset = y * scanlineStride;
    const filter = inflated[inputOffset];
    const row = new Uint8Array(width * 3);
    const filtered = inflated.subarray(
      inputOffset + 1,
      inputOffset + 1 + row.length,
    );
    for (let i = 0; i < row.length; i += 1) {
      const left = i >= 3 ? row[i - 3] : 0;
      const up = previous[i] ?? 0;
      const upperLeft = i >= 3 ? previous[i - 3] : 0;
      const value = filtered[i];
      if (filter === 0) row[i] = value;
      else if (filter === 1) row[i] = (value + left) & 255;
      else if (filter === 2) row[i] = (value + up) & 255;
      else if (filter === 3)
        row[i] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4)
        row[i] = (value + paeth(left, up, upperLeft)) & 255;
      else throw new Error(`Unsupported PNG filter: ${filter}`);
    }
    rgb.set(row, y * row.length);
    previous = row;
  }
  return { width, height, data: rgb };
}

export const encodeRgbPng = writeRgbPng;
export const parseRgbPng = decodeRgbPng;
export const encodePng = writeRgbPng;
export const decodePng = decodeRgbPng;
