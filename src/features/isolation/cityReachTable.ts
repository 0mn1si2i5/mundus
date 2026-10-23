import type { CityReachCity, CityReachCityStatus } from './cityReachTypes';

/*
 * The published city table is columnar: one array per field, countries stored
 * once and referenced by index, coordinates rounded to four decimals. Chinese
 * country names are not stored; they come from the reviewed country table when
 * the table is expanded. This module has no runtime imports so the build
 * scripts can use the same codec as the browser.
 */

export const CITY_TABLE_FORMAT_VERSION = 2;
export const CITY_NAME_MATCH_TYPES = ['override', 'exact', 'none'] as const;
export const CITY_STATUSES = [
  'ok',
  'root',
  'no_larger_reachable',
  'merged_at_resolution',
  'transport_missing',
  'disputed',
] as const satisfies readonly CityReachCityStatus[];

export interface CityTableHeader {
  referenceYear: number;
  universeMinPopulation: number;
}

export interface CityRows extends CityTableHeader {
  formatVersion: typeof CITY_TABLE_FORMAT_VERSION;
  cities: CityReachCity[];
}

export interface CityColumns {
  id: number[];
  nameEn: string[];
  nameZh: (string | null)[];
  nameMatchType: number[];
  country: number[];
  population: number[];
  latitude: number[];
  longitude: number[];
  centreLatitude: (number | null)[];
  centreLongitude: (number | null)[];
  threshold: (number | null)[];
  parentId: (number | null)[];
  status: number[];
  mergedIntoId: (number | null)[];
}

export interface CityTable extends CityTableHeader {
  formatVersion: typeof CITY_TABLE_FORMAT_VERSION;
  nameMatchTypes: readonly string[];
  statuses: readonly string[];
  countries: string[];
  cities: CityColumns;
}

const COLUMN_NAMES = [
  'id',
  'nameEn',
  'nameZh',
  'nameMatchType',
  'country',
  'population',
  'latitude',
  'longitude',
  'centreLatitude',
  'centreLongitude',
  'threshold',
  'parentId',
  'status',
  'mergedIntoId',
] as const satisfies readonly (keyof CityColumns)[];

/** Rounds a coordinate to the four decimals Mundus publishes (about 11 m). */
export function roundCoordinate(value: number) {
  const rounded = Math.round(value * 1e4) / 1e4;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function encodeCityTable(
  header: CityTableHeader,
  cities: readonly CityReachCity[],
): CityTable {
  const countries = [...new Set(cities.map((city) => city.country.en))].sort();
  const countryIndex = new Map(countries.map((name, index) => [name, index]));
  const columns: CityColumns = {
    id: [],
    nameEn: [],
    nameZh: [],
    nameMatchType: [],
    country: [],
    population: [],
    latitude: [],
    longitude: [],
    centreLatitude: [],
    centreLongitude: [],
    threshold: [],
    parentId: [],
    status: [],
    mergedIntoId: [],
  };
  for (const [index, city] of cities.entries()) {
    if (city.ownerIndex !== index + 1)
      throw new Error(`City table owner index differs for ${city.id}`);
    columns.id.push(city.id);
    columns.nameEn.push(city.name.en);
    columns.nameZh.push(city.name.zh);
    columns.nameMatchType.push(
      CITY_NAME_MATCH_TYPES.indexOf(city.nameMatchType),
    );
    columns.country.push(countryIndex.get(city.country.en) as number);
    columns.population.push(city.population);
    columns.latitude.push(roundCoordinate(city.point.latitude));
    columns.longitude.push(roundCoordinate(city.point.longitude));
    columns.centreLatitude.push(
      city.centrePoint ? roundCoordinate(city.centrePoint.latitude) : null,
    );
    columns.centreLongitude.push(
      city.centrePoint ? roundCoordinate(city.centrePoint.longitude) : null,
    );
    columns.threshold.push(city.threshold);
    columns.parentId.push(city.parentId);
    columns.status.push(CITY_STATUSES.indexOf(city.status));
    columns.mergedIntoId.push(city.mergedIntoId);
  }
  return {
    formatVersion: CITY_TABLE_FORMAT_VERSION,
    referenceYear: header.referenceYear,
    universeMinPopulation: header.universeMinPopulation,
    nameMatchTypes: CITY_NAME_MATCH_TYPES,
    statuses: CITY_STATUSES,
    countries,
    cities: columns,
  };
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isInteger = (value: unknown): value is number => Number.isInteger(value);
const sameList = (value: unknown, expected: readonly string[]) =>
  Array.isArray(value) &&
  value.length === expected.length &&
  value.every((item, index) => item === expected[index]);

function invalid(message: string): never {
  throw new Error(`Invalid city table: ${message}`);
}

/**
 * Expands a published columnar table into city rows. Structural problems
 * (missing columns, wrong lengths, unknown codes or countries) throw; the
 * callers' row validators check the meaning of each row.
 */
export function expandCityTable(
  raw: unknown,
  countryNameZh: (name: string) => string | null,
): CityRows {
  const table = raw as Partial<CityTable> | null;
  if (
    !table ||
    table.formatVersion !== CITY_TABLE_FORMAT_VERSION ||
    !isInteger(table.referenceYear) ||
    !isInteger(table.universeMinPopulation)
  )
    invalid('header');
  if (!sameList(table.nameMatchTypes, CITY_NAME_MATCH_TYPES))
    invalid('name match codes');
  if (!sameList(table.statuses, CITY_STATUSES)) invalid('status codes');
  const countries = table.countries;
  if (
    !Array.isArray(countries) ||
    countries.some((name) => typeof name !== 'string' || !name.trim()) ||
    new Set(countries).size !== countries.length
  )
    invalid('countries');
  const countryZh = countries.map((name) => {
    const zh = countryNameZh(name);
    if (!zh?.trim()) invalid(`country ${name} has no reviewed Chinese name`);
    return zh;
  });
  const columns = table.cities as Partial<CityColumns> | undefined;
  if (!columns || typeof columns !== 'object') invalid('columns');
  const count = columns.id?.length ?? 0;
  for (const name of COLUMN_NAMES) {
    const column = columns[name];
    if (!Array.isArray(column) || column.length !== count)
      invalid(`column ${name}`);
  }
  const c = columns as CityColumns;
  const cities: CityReachCity[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = c.id[index];
    const nameEn = c.nameEn[index];
    const nameZh = c.nameZh[index];
    const countryIndex = c.country[index];
    const population = c.population[index];
    const latitude = c.latitude[index];
    const longitude = c.longitude[index];
    const centreLatitude = c.centreLatitude[index];
    const centreLongitude = c.centreLongitude[index];
    const threshold = c.threshold[index];
    const parentId = c.parentId[index];
    const mergedIntoId = c.mergedIntoId[index];
    const nameMatchType = isInteger(c.nameMatchType[index])
      ? CITY_NAME_MATCH_TYPES[c.nameMatchType[index] as number]
      : undefined;
    const status = isInteger(c.status[index])
      ? CITY_STATUSES[c.status[index] as number]
      : undefined;
    const country = isInteger(countryIndex)
      ? countries[countryIndex]
      : undefined;
    const countryChinese = isInteger(countryIndex)
      ? countryZh[countryIndex]
      : undefined;
    if (
      !isInteger(id) ||
      typeof nameEn !== 'string' ||
      (nameZh !== null && typeof nameZh !== 'string') ||
      country === undefined ||
      countryChinese === undefined ||
      nameMatchType === undefined ||
      status === undefined ||
      !isNumber(population) ||
      !isNumber(latitude) ||
      !isNumber(longitude) ||
      (centreLatitude === null) !== (centreLongitude === null) ||
      (centreLatitude !== null && !isNumber(centreLatitude)) ||
      (centreLongitude !== null && !isNumber(centreLongitude)) ||
      (threshold !== null && !isNumber(threshold)) ||
      (parentId !== null && !isInteger(parentId)) ||
      (mergedIntoId !== null && !isInteger(mergedIntoId))
    )
      invalid(`row ${index + 1}`);
    cities.push({
      id,
      ownerIndex: index + 1,
      name: { en: nameEn, zh: nameZh ?? null },
      nameMatchType,
      country: { en: country, zh: countryChinese },
      population,
      point: { latitude, longitude },
      centrePoint:
        isNumber(centreLatitude) && isNumber(centreLongitude)
          ? { latitude: centreLatitude, longitude: centreLongitude }
          : null,
      threshold: threshold ?? null,
      parentId: parentId ?? null,
      status,
      mergedIntoId: mergedIntoId ?? null,
    });
  }
  return {
    formatVersion: CITY_TABLE_FORMAT_VERSION,
    referenceYear: table.referenceYear,
    universeMinPopulation: table.universeMinPopulation,
    cities,
  };
}
