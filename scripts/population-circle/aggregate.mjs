/**
 * Sum a north-up, west-first population raster onto an equirectangular grid
 * by source pixel centre. Rows come from the reviewed GHS-POP GeoTIFF reader,
 * which always yields north-to-south rows of west-to-east values.
 */
export async function aggregateToGrid(
  reader,
  { width, height, onProgress } = {},
) {
  if (!Number.isInteger(width) || !Number.isInteger(height))
    throw new TypeError('Target grid dimensions must be integers');
  const { metadata } = reader;
  const [west, south, east, north] = metadata.bounds;
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  const stepX = (east - west) / sourceWidth;
  const stepY = (north - south) / sourceHeight;
  const scale = metadata.scale ?? 1;
  const offset = metadata.offset ?? 0;
  const nodata = metadata.nodata ?? null;
  const columns = new Int32Array(sourceWidth);
  for (let column = 0; column < sourceWidth; column += 1) {
    const longitude = west + (column + 0.5) * stepX;
    const wrapped = ((((longitude + 180) % 360) + 360) % 360) / 360;
    columns[column] = Math.min(width - 1, Math.floor(wrapped * width));
  }
  // Kahan-compensated sums keep the per-cell and global totals reproducible
  // to well below one person across 900 million source pixels.
  const sums = new Float64Array(width * height);
  const corrections = new Float64Array(width * height);
  let sourceTotal = 0;
  let sourceCorrection = 0;
  let populatedPixels = 0;
  let expectedRow = 0;
  for await (const { row, values } of reader.rows()) {
    if (row !== expectedRow || values.length !== sourceWidth)
      throw new Error(`Source row ${row} is out of order or has wrong width`);
    expectedRow += 1;
    const latitude = north - (row + 0.5) * stepY;
    const targetRow = Math.min(
      height - 1,
      Math.max(0, Math.floor(((90 - latitude) / 180) * height)),
    );
    const base = targetRow * width;
    for (let column = 0; column < sourceWidth; column += 1) {
      const raw = values[column];
      if (nodata !== null && raw === nodata) continue;
      const value = raw * scale + offset;
      if (!Number.isFinite(value) || value < 0)
        throw new Error(
          `Invalid population ${raw} at row ${row}, column ${column}`,
        );
      if (value === 0) continue;
      populatedPixels += 1;
      const index = base + columns[column];
      const y = value - corrections[index];
      const t = sums[index] + y;
      corrections[index] = t - sums[index] - y;
      sums[index] = t;
      const sy = value - sourceCorrection;
      const st = sourceTotal + sy;
      sourceCorrection = st - sourceTotal - sy;
      sourceTotal = st;
    }
    if (onProgress && row % 1024 === 0) onProgress(row / sourceHeight);
  }
  if (expectedRow !== sourceHeight)
    throw new Error(`Reader yielded ${expectedRow} of ${sourceHeight} rows`);
  let gridTotal = 0;
  let gridCorrection = 0;
  for (const value of sums) {
    const y = value - gridCorrection;
    const t = gridTotal + y;
    gridCorrection = t - gridTotal - y;
    gridTotal = t;
  }
  const relativeError =
    sourceTotal === 0 ? 0 : Math.abs(gridTotal - sourceTotal) / sourceTotal;
  if (relativeError >= 1e-9)
    throw new Error(`Grid total differs from source by ${relativeError}`);
  return { width, height, sums, sourceTotal, gridTotal, populatedPixels };
}

const RGB_LIMIT = 2 ** 24;

/** Round to whole persons, or to tens when a cell would overflow 24 bits. */
export function quantizeGrid({ width, height, sums }) {
  let maximum = 0;
  for (const value of sums) if (value > maximum) maximum = value;
  let unit = 1;
  while (Math.round(maximum / unit) >= RGB_LIMIT) unit *= 10;
  const counts = new Uint32Array(width * height);
  let roundedTotal = 0;
  let populatedCells = 0;
  for (let i = 0; i < sums.length; i += 1) {
    const count = Math.round(sums[i] / unit);
    counts[i] = count;
    roundedTotal += count * unit;
    if (count > 0) populatedCells += 1;
  }
  return { width, height, unit, counts, roundedTotal, populatedCells, maximum };
}

export function countsToRgb({ width, height, counts }) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < counts.length; i += 1) {
    const value = counts[i];
    rgb[i * 3] = (value >>> 16) & 255;
    rgb[i * 3 + 1] = (value >>> 8) & 255;
    rgb[i * 3 + 2] = value & 255;
  }
  return rgb;
}
