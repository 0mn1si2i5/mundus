import pngUrl from '../../data/generated/population-circle-0p25.png?url';
import manifest from '../../data/manifests/population-circle.json';
import { decodePngRgb } from '../reshaped/pngCore.mjs';
import {
  EARTH_RADIUS_KM,
  prepareCells,
  type PopulationCells,
} from './circleProfile.mjs';
import type { GeoPoint } from '../globe/geo';

export interface SmallestHalfCircle {
  point: GeoPoint;
  radiusKm: number;
  population: number;
}

export interface CircleDataset {
  width: number;
  height: number;
  cells: PopulationCells;
  /** log₁₀(1 + people/km²) / 4 scaled to 0–255, row 0 at the north edge. */
  displayDensity: Uint8Array;
  total: number;
  year: number;
  smallest: SmallestHalfCircle;
}

const DEG = Math.PI / 180;

export function displayDensity(
  counts: Uint32Array,
  width: number,
  height: number,
  unit: number,
): Uint8Array {
  const output = new Uint8Array(width * height);
  const cellLongitude = (360 / width) * DEG;
  for (let row = 0; row < height; row += 1) {
    const north = (90 - (row * 180) / height) * DEG;
    const south = (90 - ((row + 1) * 180) / height) * DEG;
    const area =
      EARTH_RADIUS_KM ** 2 *
      cellLongitude *
      (Math.sin(north) - Math.sin(south));
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const count = counts[index]!;
      if (count === 0) continue;
      const level = Math.log10(1 + (count * unit) / area) / 4;
      output[index] = Math.max(1, Math.round(Math.min(1, level) * 255));
    }
  }
  return output;
}

export async function decodeCircleDataset(
  buffer: ArrayBuffer,
): Promise<CircleDataset> {
  const { grid, totals, smallestHalfCircle, year } = manifest;
  const decoded = await decodePngRgb(buffer);
  if (decoded.width !== grid.width || decoded.height !== grid.height)
    throw new Error('Population grid does not match its manifest');
  const cells = prepareCells(decoded.ids, grid.width, grid.height, grid.unit);
  if (cells.total !== totals.published)
    throw new Error('Population grid total does not match its manifest');
  return {
    width: grid.width,
    height: grid.height,
    cells,
    displayDensity: displayDensity(
      decoded.ids,
      grid.width,
      grid.height,
      grid.unit,
    ),
    total: cells.total,
    year,
    smallest: {
      point: {
        latitude: smallestHalfCircle.latitude,
        longitude: smallestHalfCircle.longitude,
      },
      radiusKm: smallestHalfCircle.radiusKm,
      population: smallestHalfCircle.population,
    },
  };
}

export async function loadCircleDataset(
  signal?: AbortSignal,
): Promise<CircleDataset> {
  const response = await fetch(pngUrl, { signal });
  if (!response.ok)
    throw new Error(`Population grid request failed: ${response.status}`);
  return decodeCircleDataset(await response.arrayBuffer());
}
