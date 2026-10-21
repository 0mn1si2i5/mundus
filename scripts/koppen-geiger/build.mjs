import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { writeRgbPng } from '../reshaped-earth/png.mjs';

export const CLASS_COUNT = 30;
export const ASSET_PATH = 'src/data/generated/koppen-geiger/classes.png';
export const MANIFEST_PATH = 'src/data/manifests/koppen-geiger.json';

/**
 * Parse the dataset's `legend.txt`, whose class lines read
 * `    1:  Af   Tropical, rainforest      [0 0 255]`.
 */
export function parseLegend(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(\d+):\s+([A-Z][A-Za-z]{1,2})\s+(.*?)\s*\[(\d+)\s+(\d+)\s+(\d+)\]\s*$/,
    );
    if (!match) continue;
    rows.push({
      value: Number(match[1]),
      code: match[2],
      description: match[3],
      rgb: [Number(match[4]), Number(match[5]), Number(match[6])],
    });
  }
  return rows;
}

/** The legend must name the same 30 codes and colours Mundus displays. */
export function verifyLegend(rows, classes) {
  if (rows.length !== CLASS_COUNT)
    throw new Error(`Legend lists ${rows.length} classes, not ${CLASS_COUNT}`);
  rows.forEach((row, index) => {
    const expected = classes[index];
    if (
      row.value !== index + 1 ||
      row.code !== expected.code ||
      row.rgb.join(',') !== expected.rgb.join(',')
    )
      throw new Error(
        `Legend class ${index + 1} is ${row.code} [${row.rgb.join(' ')}]; Mundus expects ${expected.code} [${expected.rgb.join(' ')}]`,
      );
  });
}

/**
 * Validate a whole-globe, north-up raster and return its class bytes.
 * Only the declared nodata value may fall outside 0..30; it becomes 0.
 */
export function classesFromRaster({ width, height, bbox, values, noData }) {
  const [west, south, east, north] = bbox;
  const step = (east - west) / width;
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  if (
    !close(west, -180) ||
    !close(east, 180) ||
    !close(north, 90) ||
    !close(south, -90) ||
    !close((north - south) / height, step) ||
    values.length !== width * height
  )
    throw new Error('Köppen-Geiger raster must be a whole-globe square grid');
  const classes = new Uint8Array(values.length);
  const counts = new Array(CLASS_COUNT + 1).fill(0);
  let noDataCells = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (noData !== null && value === noData) {
      noDataCells += 1;
      continue;
    }
    if (!Number.isInteger(value) || value < 0 || value > CLASS_COUNT)
      throw new Error(`Unexpected Köppen-Geiger value ${value} at cell ${i}`);
    classes[i] = value;
    counts[value] += 1;
  }
  if (counts.slice(1).some((count) => count === 0))
    throw new Error('Every Köppen-Geiger class must occur in the raster');
  return {
    grid: { width, height, west: -180, north: 90, step: 360 / width },
    classes,
    counts,
    noDataCells,
  };
}

/** Share of classified land area per class, weighting rows by true area. */
export function landShares({ grid, classes }) {
  const area = new Array(CLASS_COUNT + 1).fill(0);
  const radians = Math.PI / 180;
  for (let row = 0; row < grid.height; row += 1) {
    const top = grid.north - row * grid.step;
    const weight =
      Math.sin(top * radians) - Math.sin((top - grid.step) * radians);
    for (let column = 0; column < grid.width; column += 1)
      area[classes[row * grid.width + column]] += weight;
  }
  const land = area.slice(1).reduce((sum, value) => sum + value, 0);
  return area.slice(1).map((value) => Number((value / land).toFixed(6)));
}

/** Class values go in the blue channel so the browser's ID decoder reads them. */
export function encodeClassPng({ grid, classes }) {
  const rgb = new Uint8Array(classes.length * 3);
  for (let i = 0; i < classes.length; i += 1) rgb[i * 3 + 2] = classes[i];
  return writeRgbPng(grid.width, grid.height, rgb);
}

export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

export function createManifest({ source, capture, raster, shares, png }) {
  return {
    id: 'koppen-geiger',
    formatVersion: 1,
    sourceName: 'Köppen-Geiger climate classification maps (Beck et al. 2023)',
    sourceUrl: source.landingUrl,
    paperUrl: source.paperDoi,
    licenseName: source.licence,
    licenseUrl: source.licenceUrl,
    version: 'V2, 1991–2020, 0.1°',
    period: source.period,
    retrievedAt: source.retrievedAt,
    attribution: source.citation,
    redistribution: 'allowed',
    transformations: [
      'Use the published 0.1° 1991–2020 GeoTIFF unchanged; no resampling or reclassification',
      'Check the archive legend against the 30 reviewed Mundus class codes and colours',
      'Store class values 0–30 in the blue channel of an RGB PNG (R = G = 0)',
      'Land share per class weights each cell by its true spherical area',
    ],
    missingValuePolicy:
      '0 is water or no data and is never shown as a class. A selected point or city on a water cell takes the nearest classified cell within two cells; otherwise it has no class.',
    boundaryPolicy:
      'Classes are drawn only on the Natural Earth land surface; unclassified land cells are neutral grey.',
    sourceAsset: {
      fileName: source.fileName,
      distributionUrl: source.distributionUrl,
      sha256: source.sha256,
      rawBytes: source.bytes,
      member: capture.member,
      memberSha256: capture.memberSha256,
      legendSha256: capture.legendSha256,
      noDataCells: raster.noDataCells,
    },
    grid: raster.grid,
    landShare: shares,
    derivedAsset: {
      path: ASSET_PATH,
      sha256: sha256(png),
      rawBytes: png.byteLength,
      gzipBytes: gzipSync(png, { level: 9, mtime: 0 }).byteLength,
      width: raster.grid.width,
      height: raster.grid.height,
      encoding: 'RGB8: B = class value 0–30; R = G = 0',
    },
  };
}
