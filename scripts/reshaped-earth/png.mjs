import { constants, deflateSync, inflateSync } from 'node:zlib';

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
    // PNG filters are reversible byte operations, with no colour transform.
    // Fixed Sub filtering keeps all RGB bytes exact and gives deterministic
    // compression of the smooth vector distance channel and categorical IDs.
    const outputOffset = y * (stride + 1);
    scanlines[outputOffset] = 1;
    for (let i = 0; i < stride; i += 1) {
      const value = rgb[y * stride + i];
      const left = i >= 3 ? rgb[y * stride + i - 3] : 0;
      scanlines[outputOffset + i + 1] = (value - left) & 255;
    }
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
    chunk(
      'IDAT',
      deflateSync(scanlines, { level: 9, strategy: constants.Z_FILTERED }),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
