import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ghslCountryNameZh } from '../globe/countryNames';
import {
  encodeCityTable,
  expandCityTable,
  type CityTable,
} from './cityReachTable';
import type { CityReachCity } from './cityReachTypes';

const header = { referenceYear: 2025, universeMinPopulation: 100_000 };

function rows(): CityReachCity[] {
  return [
    {
      id: 6,
      ownerIndex: 1,
      name: { en: 'Victoria', zh: '维多利亚' },
      nameMatchType: 'exact',
      country: { en: 'Canada', zh: '加拿大' },
      population: 250_759.7761,
      point: { latitude: 48.4458997887983, longitude: -123.36035433881403 },
      centrePoint: { latitude: 48.45, longitude: -123.35 },
      threshold: 7.3544832938269655,
      parentId: 358,
      status: 'ok',
      mergedIntoId: null,
    },
    {
      id: 358,
      ownerIndex: 2,
      name: { en: 'Unnamed', zh: null },
      nameMatchType: 'none',
      country: { en: 'Guinea', zh: '几内亚' },
      population: 1_000_000,
      point: { latitude: -0.00001, longitude: 179.99999 },
      centrePoint: null,
      threshold: null,
      parentId: null,
      status: 'merged_at_resolution',
      mergedIntoId: 6,
    },
  ];
}

describe('columnar city table', () => {
  it('keeps every field except coordinates, which round to four decimals', () => {
    const table = encodeCityTable(header, rows());
    expect(table.countries).toEqual(['Canada', 'Guinea']);
    const expanded = expandCityTable(
      JSON.parse(JSON.stringify(table)),
      ghslCountryNameZh,
    );
    expect(expanded).toEqual({
      formatVersion: 2,
      ...header,
      cities: rows().map((city) => ({
        ...city,
        point: {
          latitude: Number(city.point.latitude.toFixed(4)) || 0,
          longitude: Number(city.point.longitude.toFixed(4)),
        },
      })),
    });
    expect(Object.is(expanded.cities[1]!.point.latitude, -0)).toBe(false);
  });

  it('takes Chinese country names from the reviewed table and rejects unknown countries', () => {
    const table = encodeCityTable(header, rows());
    table.countries[1] = 'Atlantis';
    expect(() => expandCityTable(table, ghslCountryNameZh)).toThrow(/Atlantis/);
  });

  it('rejects short columns, unknown codes and owner order changes', () => {
    const short = encodeCityTable(header, rows());
    short.cities.threshold.pop();
    expect(() => expandCityTable(short, ghslCountryNameZh)).toThrow(
      /column threshold/,
    );
    const unknown = encodeCityTable(header, rows());
    unknown.cities.status[0] = 99;
    expect(() => expandCityTable(unknown, ghslCountryNameZh)).toThrow(/row 1/);
    const reordered = { ...encodeCityTable(header, rows()), statuses: [] };
    expect(() => expandCityTable(reordered, ghslCountryNameZh)).toThrow(
      /status codes/,
    );
    const swapped = rows().reverse();
    expect(() => encodeCityTable(header, swapped)).toThrow(/owner index/);
  });

  it('reads the published table back to identical bytes', () => {
    const text = readFileSync(
      `${process.cwd()}/src/data/generated/city-reach.json`,
      'utf8',
    );
    const table = JSON.parse(text) as CityTable;
    const expanded = expandCityTable(table, ghslCountryNameZh);
    expect(expanded.cities).toHaveLength(table.cities.id.length);
    for (const city of expanded.cities)
      expect(city.country.zh).toBe(ghslCountryNameZh(city.country.en));
    expect(
      `${JSON.stringify(encodeCityTable(expanded, expanded.cities))}\n`,
    ).toBe(text);
  });
});
