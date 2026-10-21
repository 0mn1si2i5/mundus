import { deflateSync, inflateSync } from 'node:zlib';
import { DISPUTED_OWNER, MAX_OWNER } from './config.mjs';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length, 0);
  name.copy(result, 4);
  bytes.copy(result, 8);
  result.writeUInt32BE(
    crc32(result.subarray(4, bytes.length + 8)),
    bytes.length + 8,
  );
  return result;
}
function encodeRgbPng(width, height, values, channels) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 4096 ||
    height > 4096 ||
    values.length !== width * height
  )
    throw new Error('Invalid city-reach texture dimensions');
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const offset = row * (width * 3 + 1) + 1 + column * 3;
      const [r, g, b] = channels(values[index]);
      scanlines[offset] = r;
      scanlines[offset + 1] = g;
      scanlines[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2; // RGB, no alpha: browser premultiplication cannot alter data.
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function encodeOwnerPng(width, height, owners) {
  return encodeRgbPng(width, height, owners, (owner) => {
    if (
      !Number.isInteger(owner) ||
      owner < 0 ||
      (owner > MAX_OWNER && owner !== DISPUTED_OWNER)
    )
      throw new Error(`Invalid texture owner ${owner}`);
    return [owner & 255, owner >>> 8, 0];
  });
}

export function encodeDensityPng(width, height, density) {
  return encodeRgbPng(width, height, density, (value) => {
    if (!Number.isInteger(value) || value < 0 || value > 255)
      throw new Error(`Invalid texture density ${value}`);
    return [value, 0, 0];
  });
}

/** Verifier for this pipeline's deliberately minimal RGB8 PNG format. */
function decodeRgbPng(bytes) {
  if (!bytes.subarray(0, 8).equals(SIGNATURE))
    throw new Error('Invalid city-reach PNG signature');
  let offset = 8;
  let width;
  let height;
  let ended = false;
  const data = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (
      offset + 12 + length > bytes.length ||
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
        bytes.readUInt32BE(offset + 8 + length)
    )
      throw new Error('Invalid city-reach PNG chunk or CRC');
    const value = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      if (
        width !== undefined ||
        length !== 13 ||
        value[8] !== 8 ||
        value[9] !== 2 ||
        value[10] ||
        value[11] ||
        value[12]
      )
        throw new Error('City-reach PNG must be non-interlaced RGB8');
      width = value.readUInt32BE(0);
      height = value.readUInt32BE(4);
      if (!width || !height || width > 4096 || height > 4096)
        throw new Error('City-reach PNG exceeds texture-size budget');
    } else if (type === 'IDAT') data.push(value);
    else if (type === 'IEND') {
      ended = true;
      offset += 12 + length;
      break;
    } else throw new Error(`Unexpected city-reach PNG chunk ${type}`);
    offset += 12 + length;
  }
  if (!ended || offset !== bytes.length || width === undefined || !data.length)
    throw new Error('Truncated city-reach PNG');
  const raw = inflateSync(Buffer.concat(data), {
    maxOutputLength: height * (width * 3 + 1),
  });
  if (raw.length !== height * (width * 3 + 1))
    throw new Error('Invalid city-reach PNG scanline length');
  for (let row = 0; row < height; row += 1) {
    if (raw[row * (width * 3 + 1)] !== 0)
      throw new Error('Unexpected city-reach PNG filter');
  }
  return { width, height, raw };
}

export function decodeOwnerPng(bytes) {
  const { width, height, raw } = decodeRgbPng(bytes);
  const owners = new Uint16Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const start = row * (width * 3 + 1) + 1 + column * 3;
      if (raw[start + 2] !== 0) throw new Error('Owner PNG must have B = 0');
      owners[index] = raw[start] + 256 * raw[start + 1];
    }
  }
  return { width, height, owners };
}

export function decodeDensityPng(bytes) {
  const { width, height, raw } = decodeRgbPng(bytes);
  const density = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const start = row * (width * 3 + 1) + 1 + column * 3;
      if (raw[start + 1] !== 0 || raw[start + 2] !== 0)
        throw new Error('Density PNG must have G = B = 0');
      density[index] = raw[start];
    }
  }
  return { width, height, density };
}

export function ownershipTiles({ grid, owners, disputed }, tier) {
  const width = Math.ceil(grid.width / tier.stride);
  const height = Math.ceil(grid.height / tier.stride);
  const tiles = [];
  for (let tileRow = 0; tileRow < tier.tileRows; tileRow += 1) {
    for (let tileColumn = 0; tileColumn < tier.tileColumns; tileColumn += 1) {
      const left = Math.floor((tileColumn * width) / tier.tileColumns);
      const right = Math.floor(((tileColumn + 1) * width) / tier.tileColumns);
      const top = Math.floor((tileRow * height) / tier.tileRows);
      const bottom = Math.floor(((tileRow + 1) * height) / tier.tileRows);
      if (right === left || bottom === top) continue;
      const ids = new Uint16Array((right - left) * (bottom - top));
      for (let row = top; row < bottom; row += 1) {
        const sourceRow = Math.min(
          grid.height - 1,
          row * tier.stride + Math.floor(tier.stride / 2),
        );
        for (let column = left; column < right; column += 1) {
          const sourceColumn = Math.min(
            grid.width - 1,
            column * tier.stride + Math.floor(tier.stride / 2),
          );
          const source = sourceRow * grid.width + sourceColumn;
          const target = (row - top) * (right - left) + column - left;
          ids[target] = disputed[source] ? DISPUTED_OWNER : owners[source];
        }
      }
      tiles.push({
        tileRow,
        tileColumn,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        bytes: encodeOwnerPng(right - left, bottom - top, ids),
      });
    }
  }
  return { width, height, tiles };
}

export function densityTexture({ grid, density }, tier) {
  if (density.length !== grid.width * grid.height)
    throw new Error('Invalid computational density dimensions');
  const stride = tier.densityStride;
  const width = Math.ceil(grid.width / stride);
  const height = Math.ceil(grid.height / stride);
  const values = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = Math.min(
      grid.height - 1,
      row * stride + Math.floor(stride / 2),
    );
    for (let column = 0; column < width; column += 1) {
      const sourceColumn = Math.min(
        grid.width - 1,
        column * stride + Math.floor(stride / 2),
      );
      values[row * width + column] =
        density[sourceRow * grid.width + sourceColumn];
    }
  }
  return {
    x: 0,
    y: 0,
    width,
    height,
    bytes: encodeDensityPng(width, height, values),
  };
}
