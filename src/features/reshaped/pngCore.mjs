const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1)
    crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

/** Opaque ID bytes never pass through canvas or browser colour management. */
export async function decodePngRgb(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 33 || !SIGNATURE.every((value, i) => bytes[i] === value))
    throw new Error('Invalid ID PNG signature');
  const view = new DataView(buffer);
  let offset = 8,
    width = 0,
    height = 0,
    ended = false;
  const chunks = [];
  let compressedLength = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('Truncated ID PNG chunk');
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12)
      throw new Error('ID PNG chunk exceeds input');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
      view.getUint32(offset + 8 + length)
    )
      throw new Error('ID PNG CRC mismatch');
    const start = offset + 8;
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13)
        throw new Error('Invalid ID PNG header');
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 2048 ||
        bytes[start + 8] !== 8 ||
        bytes[start + 9] !== 2 ||
        bytes[start + 10] !== 0 ||
        bytes[start + 11] !== 0 ||
        bytes[start + 12] !== 0
      )
        throw new Error('Unsupported ID PNG format');
    } else if (type === 'IDAT') {
      if (!width) throw new Error('ID PNG data before header');
      chunks.push(bytes.subarray(start, start + length));
      compressedLength += length;
    } else if (type === 'IEND') {
      if (length !== 0 || offset + 12 !== bytes.length)
        throw new Error('Invalid ID PNG ending');
      ended = true;
      break;
    } else throw new Error(`Unsupported ID PNG chunk ${type}`);
    offset += length + 12;
  }
  if (!ended || !chunks.length) throw new Error('Incomplete ID PNG');
  if (typeof DecompressionStream !== 'function')
    throw new Error('DECOMPRESSION_UNAVAILABLE');
  const compressed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }
  const expected = (width * 3 + 1) * height;
  const reader = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  const inflated = new Uint8Array(expected);
  cursor = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (cursor + value.length > expected)
        throw new Error('ID PNG decompressed length mismatch');
      inflated.set(value, cursor);
      cursor += value.length;
    }
  } finally {
    await reader.cancel();
  }
  if (cursor !== expected)
    throw new Error('ID PNG decompressed length mismatch');
  const ids = new Uint32Array(width * height);
  const stride = width * 3;
  const previous = new Uint8Array(stride),
    row = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)];
    if (filter > 4) throw new Error('Unsupported ID PNG filter');
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 3 ? row[i - 3] : 0,
        up = previous[i],
        corner = i >= 3 ? previous[i - 3] : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      if (filter === 2) prediction = up;
      if (filter === 3) prediction = Math.floor((left + up) / 2);
      if (filter === 4) {
        const p = left + up - corner,
          a = Math.abs(p - left),
          b = Math.abs(p - up),
          c = Math.abs(p - corner);
        prediction = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      row[i] = (inflated[y * (stride + 1) + 1 + i] + prediction) & 255;
    }
    for (let x = 0; x < width; x += 1)
      ids[y * width + x] =
        row[x * 3] * 65536 + row[x * 3 + 1] * 256 + row[x * 3 + 2];
    previous.set(row);
  }
  return { width, height, ids };
}
