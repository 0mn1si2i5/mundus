import { describe, expect, it } from 'vitest';
import type { GeoNamesCity } from '../antipodes/geonamesCities';
import {
  climateGrid,
  cityClimateClasses,
  findClimateTwins,
  fitClimateTexture,
  sampleClimate,
  type ClimateDataset,
} from './climateMetrics';
import { KOPPEN_CLASSES, koppenClass } from './koppenClasses';

// A 1° globe: class 14 (Cfa) east of 100°E, class 8 (Csa) west of 0°, class 21
// (Dwa) in between, all between 20°N and 50°N; water elsewhere, including an
// Atlantic gap from 60°W to 20°W.
function dataset(): ClimateDataset {
  const grid = climateGrid({
    width: 360,
    height: 180,
    west: -180,
    north: 90,
    step: 1,
  });
  const classes = new Uint8Array(360 * 180);
  for (let row = 40; row < 70; row += 1)
    for (let column = 0; column < 360; column += 1) {
      const longitude = column - 180 + 0.5;
      if (longitude > -60 && longitude < -20) continue;
      classes[row * 360 + column] =
        longitude > 100 ? 14 : longitude < 0 ? 8 : 21;
    }
  // Leave a water channel at 60°E–62°E so snapping can be tested.
  for (let row = 40; row < 70; row += 1)
    for (let column = 240; column < 243; column += 1)
      classes[row * 360 + column] = 0;
  return { grid, classes, landShare: KOPPEN_CLASSES.map(() => 1 / 30) };
}

let nextId = 1;
function city(
  name: string,
  latitude: number,
  longitude: number,
  population: number,
  countryCode = name.slice(0, 2).toUpperCase(),
): GeoNamesCity {
  return {
    id: nextId++,
    name: { zh: name, en: name },
    nameZhFallback: false,
    country: { zh: countryCode, en: countryCode },
    admin1: null,
    countryCode,
    point: { latitude, longitude },
    population,
    featureCode: 'PPL',
    aliases: [],
    search: {
      nameEn: name,
      nameZh: name,
      countryEn: countryCode,
      countryZh: countryCode,
      adminEn: '',
      adminZh: '',
      aliases: [],
    },
  };
}

describe('Köppen classes', () => {
  it('lists 30 classes in dataset order with unique codes', () => {
    expect(KOPPEN_CLASSES).toHaveLength(30);
    expect(new Set(KOPPEN_CLASSES.map((type) => type.code)).size).toBe(30);
    KOPPEN_CLASSES.forEach((type, index) => {
      expect(type.value).toBe(index + 1);
      expect(type.code[0]).toBe(type.group);
      expect(type.name.zh).not.toBe(type.name.en);
    });
    expect(koppenClass(0)).toBeNull();
    expect(koppenClass(31)).toBeNull();
  });
});

describe('sampleClimate', () => {
  it('reads the cell under a point and wraps longitude', () => {
    const data = dataset();
    expect(sampleClimate(data, { latitude: 39.9, longitude: 116.4 })).toEqual({
      value: 14,
      snapped: false,
    });
    expect(sampleClimate(data, { latitude: 40.4, longitude: -3.7 })).toEqual({
      value: 8,
      snapped: false,
    });
    expect(
      sampleClimate(data, { latitude: 40.4, longitude: 180 - 1e-9 })?.value,
    ).toBe(14);
  });

  it('snaps a water point to land within two cells, else has no class', () => {
    const data = dataset();
    expect(sampleClimate(data, { latitude: 30.5, longitude: 60.5 })).toEqual({
      value: 21,
      snapped: true,
    });
    expect(sampleClimate(data, { latitude: 30.5, longitude: 61.5 })).toEqual({
      value: 21,
      snapped: true,
    });
    expect(sampleClimate(data, { latitude: 0, longitude: 0 })).toBeNull();
    expect(sampleClimate(data, { latitude: 90, longitude: 0 })).toBeNull();
  });

  it('caches city classes per dataset and city list', () => {
    const data = dataset();
    const cities = [city('Beijing', 39.9, 116.4, 20e6), city('Sea', 0, 0, 1)];
    const first = cityClimateClasses(data, cities);
    expect([...first]).toEqual([14, 0]);
    expect(cityClimateClasses(data, cities)).toBe(first);
  });
});

describe('findClimateTwins', () => {
  const cities = [
    city('Beijing', 39.9, 116.4, 20e6, 'CN'),
    city('Tianjin', 39.1, 117.2, 11e6, 'CN'),
    city('Madrid', 40.4, -3.7, 6e6, 'ES'),
    city('Lisbon', 38.7, -9.1, 3e6, 'PT'),
    city('Ankara', 39.9, 32.9, 5e6, 'TR'),
    city('Tashkent', 41.3, 69.2, 2.5e6, 'UZ'),
    city('Shanghai', 31.2, 121.5, 24e6, 'CN'),
    city('Seoul', 37.6, 127, 10e6, 'KR'),
    city('Atlanta', 33.7, -84.4, 0.5e6, 'US'),
  ];

  it('lists different climates on the same latitude, one per class', () => {
    const twins = findClimateTwins(dataset(), cities, {
      latitude: 39.9,
      longitude: 116.4,
    });
    expect(twins.sample).toEqual({ value: 14, snapped: false });
    // Madrid (Csa) and Ankara (Dwa) qualify; Lisbon repeats Csa, Tianjin is
    // within 500 km and shares Cfa.
    expect(twins.sameLatitude.map((match) => match.city.name.en)).toEqual([
      'Madrid',
      'Ankara',
    ]);
  });

  it('lists distant cities of the same climate, one per country', () => {
    const twins = findClimateTwins(dataset(), cities, {
      latitude: 40.4,
      longitude: -3.7,
    });
    expect(twins.sample?.value).toBe(8);
    // Atlanta is Csa in this fixture and more than 3,000 km away; Lisbon is
    // the same class but too close.
    expect(twins.farTwins.map((match) => match.city.name.en)).toEqual([
      'Atlanta',
    ]);
    expect(twins.farTwins[0]!.distanceKm).toBeGreaterThan(3000);
  });

  it('keeps latitude neighbours but no twins for an ocean point', () => {
    const twins = findClimateTwins(dataset(), cities, {
      latitude: 39.5,
      longitude: -40,
    });
    expect(twins.sample).toBeNull();
    expect(twins.farTwins).toEqual([]);
    expect(twins.sameLatitude.map((match) => match.city.name.en)).toEqual([
      'Beijing',
      'Madrid',
      'Ankara',
    ]);
  });

  it('rejects grids that are not whole-globe', () => {
    expect(() =>
      climateGrid({ width: 100, height: 50, west: -180, north: 90, step: 1 }),
    ).toThrow(/grid/);
  });
});

describe('fitClimateTexture', () => {
  it('keeps the full grid when it fits the GPU limit', () => {
    const data = dataset();
    expect(fitClimateTexture(data, 4096).classes).toBe(data.classes);
  });

  it('halves a grid wider than the limit using block centres', () => {
    const data = dataset();
    const fitted = fitClimateTexture(data, 200);
    expect(fitted).toMatchObject({ width: 180, height: 90, step: 2 });
    // Block (x, y) samples cell (2x + 1, 2y + 1) of the source grid.
    for (const [x, y] of [
      [140, 25],
      [100, 30],
      [0, 0],
    ] as const)
      expect(fitted.classes[y * 180 + x]).toBe(
        data.classes[(2 * y + 1) * 360 + 2 * x + 1],
      );
    expect(fitted.classes.some((value) => value === 14)).toBe(true);
  });
});
