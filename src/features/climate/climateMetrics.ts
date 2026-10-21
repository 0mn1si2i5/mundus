import type { GeoPoint } from '../globe/geo';
import { surfaceDistanceKm } from '../antipodes/distance';
import type { GeoNamesCity } from '../antipodes/geonamesCities';
import type { Locale } from '../../i18n/messages';

export interface ClimateGrid {
  width: number;
  height: number;
  west: number;
  north: number;
  step: number;
}

export interface ClimateDataset {
  grid: ClimateGrid;
  /** Row-major class values from north to south; 0 is water or no data. */
  classes: Uint8Array;
  /** Share of classified land area for class value `index + 1`. */
  landShare: readonly number[];
}

export interface ClimateSample {
  value: number;
  /** True when the exact cell is water and a nearby land cell was used. */
  snapped: boolean;
}

export interface ClimateCityMatch {
  city: GeoNamesCity;
  value: number;
  distanceKm: number;
}

export interface ClimateTwins {
  sample: ClimateSample | null;
  sameLatitude: readonly ClimateCityMatch[];
  farTwins: readonly ClimateCityMatch[];
}

/** Coastal points look this many cells around for a classified land cell. */
export const CLIMATE_SNAP_CELLS = 2;
export const SAME_LATITUDE_BAND_DEGREES = 1;
export const SAME_LATITUDE_MIN_KM = 500;
export const FAR_TWIN_MIN_KM = 3000;
export const TWIN_LIMIT = 3;

export function climateGrid(grid: ClimateGrid): ClimateGrid {
  const { width, height, west, north, step } = grid;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    !(step > 0) ||
    Math.abs(width * step - 360) > 1e-6 ||
    north - height * step < -90 - 1e-6 ||
    north > 90 + 1e-6 ||
    Math.abs(west + 180) > 1e-6
  )
    throw new Error('Invalid Köppen-Geiger grid');
  return { width, height, west, north, step };
}

function cellOf(grid: ClimateGrid, point: GeoPoint) {
  const column =
    ((Math.floor((point.longitude - grid.west) / grid.step) % grid.width) +
      grid.width) %
    grid.width;
  const row = Math.min(
    grid.height - 1,
    Math.max(0, Math.floor((grid.north - point.latitude) / grid.step)),
  );
  return { column, row };
}

/**
 * The class at a point. A water cell takes the nearest classified cell within
 * `CLIMATE_SNAP_CELLS` (by squared cell distance, then row-major order), so
 * coastal cities and clicks do not fall into the sea on a coarse grid.
 */
export function sampleClimate(
  dataset: ClimateDataset,
  point: GeoPoint,
): ClimateSample | null {
  const { grid, classes } = dataset;
  const { column, row } = cellOf(grid, point);
  const exact = classes[row * grid.width + column]!;
  if (exact) return { value: exact, snapped: false };
  let best: { value: number; distance: number } | null = null;
  for (let dy = -CLIMATE_SNAP_CELLS; dy <= CLIMATE_SNAP_CELLS; dy += 1) {
    const y = row + dy;
    if (y < 0 || y >= grid.height) continue;
    for (let dx = -CLIMATE_SNAP_CELLS; dx <= CLIMATE_SNAP_CELLS; dx += 1) {
      const x = (column + dx + grid.width) % grid.width;
      const value = classes[y * grid.width + x]!;
      const distance = dx * dx + dy * dy;
      if (value && (!best || distance < best.distance))
        best = { value, distance };
    }
  }
  return best ? { value: best.value, snapped: true } : null;
}

const cityClassCache = new WeakMap<
  ClimateDataset,
  WeakMap<readonly GeoNamesCity[], Uint8Array>
>();

/** Class value per city (0 when no land cell is near enough). */
export function cityClimateClasses(
  dataset: ClimateDataset,
  cities: readonly GeoNamesCity[],
): Uint8Array {
  let byCities = cityClassCache.get(dataset);
  if (!byCities) {
    byCities = new WeakMap();
    cityClassCache.set(dataset, byCities);
  }
  let values = byCities.get(cities);
  if (!values) {
    values = Uint8Array.from(
      cities,
      (city) => sampleClimate(dataset, city.point)?.value ?? 0,
    );
    byCities.set(cities, values);
  }
  return values;
}

const byPopulation = (a: ClimateCityMatch, b: ClimateCityMatch) =>
  b.city.population - a.city.population || a.city.id - b.city.id;

/**
 * Two short lists of GeoNames major cities: the largest cities on nearly the
 * same latitude with a different climate (one per class), and the largest
 * distant cities that share the selected climate (one per country).
 */
export function findClimateTwins(
  dataset: ClimateDataset,
  cities: readonly GeoNamesCity[],
  point: GeoPoint,
): ClimateTwins {
  const sample = sampleClimate(dataset, point);
  const selected = sample?.value ?? 0;
  const values = cityClimateClasses(dataset, cities);
  const band: ClimateCityMatch[] = [];
  const twins: ClimateCityMatch[] = [];
  cities.forEach((city, index) => {
    const value = values[index]!;
    if (!value) return;
    const sameBand =
      Math.abs(city.point.latitude - point.latitude) <=
      SAME_LATITUDE_BAND_DEGREES;
    if (!sameBand && value !== selected) return;
    const distanceKm = surfaceDistanceKm(point, city.point);
    if (sameBand && value !== selected && distanceKm >= SAME_LATITUDE_MIN_KM)
      band.push({ city, value, distanceKm });
    if (selected && value === selected && distanceKm >= FAR_TWIN_MIN_KM)
      twins.push({ city, value, distanceKm });
  });
  return {
    sample,
    sameLatitude: distinctBy(band.sort(byPopulation), (m) => m.value),
    farTwins: distinctBy(twins.sort(byPopulation), (m) => m.city.countryCode),
  };
}

function distinctBy<T>(items: readonly T[], key: (item: T) => unknown) {
  const seen = new Set<unknown>();
  const result: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(item);
    if (result.length === TWIN_LIMIT) break;
  }
  return result;
}

export function formatLandShare(share: number, locale: Locale): string {
  if (share > 0 && share < 0.001)
    return locale === 'zh' ? '不到 0.1%' : '<0.1%';
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * Fit the class grid to a GPU texture limit by keeping the centre cell of
 * each `stride × stride` block. WebGL2 only guarantees 2048-texel textures;
 * selections still read the full-resolution grid.
 */
export function fitClimateTexture(
  { grid, classes }: Pick<ClimateDataset, 'grid' | 'classes'>,
  maxTextureSize: number,
): { width: number; height: number; step: number; classes: Uint8Array } {
  const stride = Math.max(
    1,
    Math.ceil(grid.width / maxTextureSize),
    Math.ceil(grid.height / maxTextureSize),
  );
  if (stride === 1)
    return { width: grid.width, height: grid.height, step: grid.step, classes };
  const width = Math.ceil(grid.width / stride);
  const height = Math.ceil(grid.height / stride);
  const fitted = new Uint8Array(width * height);
  const offset = Math.floor(stride / 2);
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(grid.height - 1, y * stride + offset);
    for (let x = 0; x < width; x += 1) {
      const column = Math.min(grid.width - 1, x * stride + offset);
      fitted[y * width + x] = classes[row * grid.width + column]!;
    }
  }
  return { width, height, step: grid.step * stride, classes: fitted };
}
