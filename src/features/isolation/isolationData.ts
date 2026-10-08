import {
  competitorAt,
  haversineKm,
  rankingAt,
  type RecordHolder,
} from './isolationMetric';
import type { GeoPoint } from '../globe/geo';

export interface IsolationCity {
  id: string;
  point: GeoPoint;
  population: number;
  name: { en: string; zh: string | null };
  country: { en: string; zh: string | null };
  isFocal: boolean;
}

export interface IsolationDataset {
  cities: readonly IsolationCity[];
  holders: readonly (readonly RecordHolder[] | null)[];
  focalIndices: readonly number[];
}

export interface IsolationSelection {
  cityIndex: number;
  distanceFromPointKm: number;
  competitor: RecordHolder | null;
  ranking: readonly {
    city: IsolationCity;
    distanceKm: number;
  }[];
  rank: { position: number; total: number } | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function decodeIsolationDataset(raw: unknown): IsolationDataset {
  if (
    !isObject(raw) ||
    raw.formatVersion !== 1 ||
    !Array.isArray(raw.strings) ||
    !Array.isArray(raw.cities) ||
    !Array.isArray(raw.holders)
  ) {
    throw new Error('Invalid Urban Isolation dataset schema');
  }
  const strings = raw.strings;
  if (!strings.every((value) => typeof value === 'string')) {
    throw new Error('Invalid Urban Isolation string table');
  }
  const stringAt = (value: unknown, nullable = false): string | null => {
    if (nullable && value === null) return null;
    if (
      !Number.isInteger(value) ||
      (value as number) < 0 ||
      (value as number) >= strings.length
    ) {
      throw new Error(
        `Urban Isolation string reference out of bounds: ${String(value)}`,
      );
    }
    return strings[value as number] ?? null;
  };
  const cities = raw.cities.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 9)
      throw new Error(`Invalid Urban Isolation city row ${index}`);
    const [
      id,
      latitudeE4,
      longitudeE4,
      population,
      nameEn,
      nameZh,
      countryEn,
      countryZh,
      isFocal,
    ] = row;
    if (
      typeof id !== 'string' ||
      !id ||
      !Number.isInteger(latitudeE4) ||
      !Number.isInteger(longitudeE4) ||
      (latitudeE4 as number) < -900000 ||
      (latitudeE4 as number) > 900000 ||
      (longitudeE4 as number) < -1800000 ||
      (longitudeE4 as number) > 1800000 ||
      typeof population !== 'number' ||
      !Number.isFinite(population) ||
      population <= 0 ||
      typeof isFocal !== 'boolean'
    ) {
      throw new Error(`Invalid Urban Isolation city values: ${String(id)}`);
    }
    const nameEnValue = stringAt(nameEn);
    const countryEnValue = stringAt(countryEn);
    if (nameEnValue === null || countryEnValue === null)
      throw new Error(`Missing Urban Isolation city labels: ${id}`);
    return {
      id,
      point: {
        latitude: (latitudeE4 as number) / 10000,
        longitude: (longitudeE4 as number) / 10000,
      },
      population,
      name: { en: nameEnValue, zh: stringAt(nameZh, true) },
      country: { en: countryEnValue, zh: stringAt(countryZh, true) },
      isFocal,
    } satisfies IsolationCity;
  });
  if (raw.holders.length !== cities.length)
    throw new Error('Urban Isolation holder count mismatch');
  const holders = raw.holders.map((value, index) => {
    if (value === null) return null;
    if (!Array.isArray(value))
      throw new Error(`Invalid Urban Isolation holders ${index}`);
    return value.map((entry) => {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        !Number.isInteger(entry[0]) ||
        (entry[0] as number) < 0 ||
        (entry[0] as number) >= cities.length ||
        typeof entry[1] !== 'number' ||
        !Number.isFinite(entry[1]) ||
        (entry[1] as number) < 0
      ) {
        throw new Error(`Invalid Urban Isolation holder ${index}`);
      }
      return { index: entry[0] as number, distanceKm: entry[1] as number };
    });
  });
  const focalIndices = cities.flatMap((city, index) =>
    city.isFocal ? [index] : [],
  );
  if (focalIndices.some((index) => holders[index] === null))
    throw new Error('Urban Isolation focal city has no holder list');
  return { cities, holders, focalIndices };
}

let datasetPromise: Promise<IsolationDataset> | undefined;

export function loadIsolationDataset(): Promise<IsolationDataset> {
  datasetPromise ??= import('../../data/generated/urban-isolation.json')
    .then((module) => decodeIsolationDataset(module.default))
    .catch((error: unknown) => {
      datasetPromise = undefined;
      throw error;
    });
  return datasetPromise;
}

export function resetIsolationDataset(): void {
  datasetPromise = undefined;
}

export function nearestFocalCity(
  point: GeoPoint,
  dataset: IsolationDataset,
): { index: number; distanceKm: number } | null {
  let nearest: { index: number; distanceKm: number } | null = null;
  for (const index of dataset.focalIndices) {
    const city = dataset.cities[index];
    if (!city) continue;
    const distanceKm = haversineKm(point, city.point);
    if (
      !nearest ||
      distanceKm < nearest.distanceKm ||
      (distanceKm === nearest.distanceKm &&
        city.id < dataset.cities[nearest.index]!.id)
    ) {
      nearest = { index, distanceKm };
    }
  }
  return nearest;
}

/** Resolve the selected focal city, its current competitor, and its ranking. */
export function computeIsolationSelection(
  point: GeoPoint,
  alpha: number,
  dataset: IsolationDataset,
  selectedCityIndex?: number | null,
): IsolationSelection | null {
  const selectedCity =
    selectedCityIndex == null ? null : dataset.cities[selectedCityIndex];
  const nearest = selectedCity?.isFocal
    ? {
        index: selectedCityIndex!,
        distanceKm: haversineKm(point, selectedCity.point),
      }
    : nearestFocalCity(point, dataset);
  if (!nearest) return null;
  const city = dataset.cities[nearest.index];
  if (!city) return null;
  const metricCities = dataset.cities.map((item) => ({
    id: item.id,
    ...item.point,
    population: item.population,
  }));
  const populations = metricCities.map((item) => item.population);
  const competitor = competitorAt(
    dataset.holders[nearest.index] ?? [],
    populations,
    city.population,
    alpha,
  );
  const ranking = rankingAt(
    dataset.focalIndices,
    metricCities,
    dataset.holders,
    alpha,
  ).map((entry) => ({
    city: dataset.cities[entry.index]!,
    distanceKm: entry.distanceKm,
  }));
  const rankIndex = ranking.findIndex((entry) => entry.city.id === city.id);
  return {
    cityIndex: nearest.index,
    distanceFromPointKm: nearest.distanceKm,
    competitor,
    ranking,
    rank:
      rankIndex >= 0
        ? { position: rankIndex + 1, total: ranking.length }
        : null,
  };
}

export function displayIsolationName(
  city: IsolationCity,
  locale: 'zh' | 'en',
): string {
  return locale === 'zh' ? (city.name.zh ?? city.name.en) : city.name.en;
}

export function displayIsolationCountry(
  city: IsolationCity,
  locale: 'zh' | 'en',
): string {
  return locale === 'zh'
    ? (city.country.zh ?? city.country.en)
    : city.country.en;
}
