import manifest from '../../data/manifests/koppen-geiger.json';
import { decodePngRgb } from '../reshaped/pngCore.mjs';
import { KOPPEN_CLASSES } from './koppenClasses';
import {
  climateGrid,
  type ClimateDataset,
  type ClimateGrid,
} from './climateMetrics';

const rasterUrl = new URL(
  '../../data/generated/koppen-geiger/classes.png',
  import.meta.url,
).href;

/** Load and verify the Köppen-Geiger class raster named by the manifest. */
export async function loadClimateDataset(
  signal?: AbortSignal,
): Promise<ClimateDataset> {
  const expected = manifest.derivedAsset;
  const response = await fetch(rasterUrl, { signal });
  if (!response.ok)
    throw new Error(`Köppen-Geiger request failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== expected.rawBytes)
    throw new Error('Köppen-Geiger asset size mismatch');
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hash = [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  if (hash !== expected.sha256)
    throw new Error('Köppen-Geiger asset hash mismatch');
  const grid = climateGrid(manifest.grid);
  return decodeClimateRaster(buffer, grid, manifest.landShare);
}

export async function decodeClimateRaster(
  buffer: ArrayBuffer,
  grid: ClimateGrid,
  landShare: readonly number[],
): Promise<ClimateDataset> {
  const raster = await decodePngRgb(buffer);
  if (raster.width !== grid.width || raster.height !== grid.height)
    throw new Error('Köppen-Geiger raster size differs from its manifest');
  if (landShare.length !== KOPPEN_CLASSES.length)
    throw new Error('Köppen-Geiger land shares must cover every class');
  const classes = new Uint8Array(raster.ids.length);
  for (let i = 0; i < classes.length; i += 1) {
    const pixel = raster.ids[i]!;
    if (pixel > KOPPEN_CLASSES.length)
      throw new Error('Invalid Köppen-Geiger class value');
    classes[i] = pixel;
  }
  return { grid, classes, landShare };
}
