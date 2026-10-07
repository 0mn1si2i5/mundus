import { describe, expect, test } from 'vitest';
import type { GeoNamesCity } from './geonamesCities';
import { createAntipodeRelation, sampleShortGeodesic } from './relation';

function city(
  id: number,
  name: string,
  latitude: number,
  longitude: number,
  population = 1_000_000,
): GeoNamesCity {
  return {
    id,
    name: { en: name, zh: name },
    nameZhFallback: false,
    country: { en: `${name} country`, zh: `${name} country` },
    admin1: null,
    countryCode: 'ZZ',
    point: { latitude, longitude },
    population,
    featureCode: 'PPL',
    aliases: [],
    search: {
      nameEn: name.toLowerCase(),
      nameZh: name.toLowerCase(),
      countryEn: '',
      countryZh: '',
      adminEn: '',
      adminZh: '',
      aliases: [],
    },
  };
}

describe('createAntipodeRelation', () => {
  test('derives exact endpoints and an independent nearest city for each side', () => {
    const originCity = city(20, 'Origin City', 10.1, 20.1);
    const antipodeCity = city(10, 'Antipode City', -10.1, -159.9);
    const relation = createAntipodeRelation({ latitude: 10, longitude: 20 }, [
      antipodeCity,
      originCity,
    ]);

    expect(relation.origin.exactPoint).toEqual({ latitude: 10, longitude: 20 });
    expect(relation.antipode.exactPoint).toEqual({
      latitude: -10,
      longitude: -160,
    });
    expect(relation.origin.nearestMajorCity?.city).toBe(originCity);
    expect(relation.antipode.nearestMajorCity?.city).toBe(antipodeCity);
    expect(relation.origin.nearestMajorCity?.distanceKm).toBeGreaterThan(0);
    expect(relation.antipode.nearestMajorCity?.distanceKm).toBeGreaterThan(0);
  });

  test('creates an exact relation shell without cities', () => {
    const relation = createAntipodeRelation({ latitude: 12, longitude: 34 });

    expect(relation.origin).toEqual({
      id: 'origin',
      exactPoint: { latitude: 12, longitude: 34 },
      nearestMajorCity: null,
    });
    expect(relation.antipode).toEqual({
      id: 'antipode',
      exactPoint: { latitude: -12, longitude: -146 },
      nearestMajorCity: null,
    });
  });

  test('does not mutate exact point or city inputs', () => {
    const point = Object.freeze({ latitude: 0, longitude: 0 });
    const cities = Object.freeze([
      Object.freeze(city(2, 'Larger', 0, 1, 2_000_000)),
      Object.freeze(city(1, 'Stable ID', 0, -1, 2_000_000)),
      Object.freeze(city(3, 'Other Side', 0, 180)),
    ]);
    const relation = createAntipodeRelation(point, cities);

    expect(relation.origin.nearestMajorCity?.city.id).toBe(1);
    expect(point).toEqual({ latitude: 0, longitude: 0 });
    expect(cities.map(({ id }) => id)).toEqual([2, 1, 3]);
  });
});

describe('sampleShortGeodesic', () => {
  test('includes exact endpoints and 17 points by default', () => {
    const points = sampleShortGeodesic(
      { latitude: 12, longitude: 30 },
      { latitude: 18, longitude: 42 },
    );
    expect(points).toHaveLength(17);
    expect(points[0]).toEqual({ latitude: 12, longitude: 30 });
    expect(points.at(-1)).toEqual({ latitude: 18, longitude: 42 });
  });

  test('takes the short finite route across the antimeridian', () => {
    const points = sampleShortGeodesic(
      { latitude: 5, longitude: 179 },
      { latitude: 5, longitude: -179 },
    );
    expect(points.some((point) => Math.abs(point.longitude) > 179.5)).toBe(
      true,
    );
    for (const point of points) {
      expect(Number.isFinite(point.latitude)).toBe(true);
      expect(Number.isFinite(point.longitude)).toBe(true);
      expect(Math.abs(point.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(point.longitude)).toBeLessThanOrEqual(180);
    }
  });

  test('returns identical finite points for a zero-length relation', () => {
    const point = { latitude: -24.5, longitude: 130.25 };
    expect(sampleShortGeodesic(point, point)).toEqual(
      Array.from({ length: 17 }, () => point),
    );
  });
});
