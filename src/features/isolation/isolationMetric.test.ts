import { describe, expect, it } from 'vitest';
import {
  ALPHA_DEFAULT,
  ALPHA_MIN,
  ALPHA_MAX,
  clampAlpha,
  competitorAt,
  haversineKm,
  parseAlphaParam,
  rankingAt,
  recordHolders,
  type MetricCity,
} from './isolationMetric';

function city(
  id: string,
  population: number,
  latitude: number,
  longitude: number,
): MetricCity {
  return { id, population, latitude, longitude };
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFixture(seed: number): MetricCity[] {
  const random = mulberry32(seed);
  const cities: MetricCity[] = [
    city(
      'focal',
      1_000_000 + random() * 5_000_000,
      -60 + random() * 120,
      -180 + random() * 360,
    ),
  ];
  for (let index = 1; index < 14; index += 1) {
    cities.push(
      city(
        `city-${index}`,
        10_000 + random() * 7_000_000,
        -90 + random() * 180,
        -180 + random() * 360,
      ),
    );
  }
  return cities;
}

function nearestByBruteForce(
  focalIndex: number,
  cities: readonly MetricCity[],
  alpha: number,
) {
  const focal = cities[focalIndex];
  if (!focal) {
    throw new Error(`Missing focal city at index ${focalIndex}`);
  }
  return (
    cities
      .map((candidate, index) => ({
        candidate,
        index,
        distanceKm: haversineKm(focal, candidate),
      }))
      .filter(
        ({ index, candidate }) =>
          index !== focalIndex &&
          candidate.population >= alpha * focal.population,
      )
      .sort((left, right) => {
        const distanceOrder = left.distanceKm - right.distanceKm;
        if (distanceOrder !== 0) return distanceOrder;
        const populationOrder =
          right.candidate.population - left.candidate.population;
        if (populationOrder !== 0) return populationOrder;
        return left.candidate.id < right.candidate.id
          ? -1
          : left.candidate.id > right.candidate.id
            ? 1
            : 0;
      })[0] ?? null
  );
}

describe('urban proximity metric', () => {
  it('matches reference great-circle distances', () => {
    expect(
      haversineKm(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 90 },
      ),
    ).toBeCloseTo(10_007.5, 0);
    expect(
      haversineKm(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 180 },
      ),
    ).toBeCloseTo(20_015.1, 0);
  });

  it('keeps strict population records in distance order', () => {
    const cities = [
      city('focal', 1_000_000, 0, 0),
      city('too-small', 50_000, 0, 1),
      city('two-hundred-k', 200_000, 0, 2),
      city('one-fifty-k', 150_000, 0, 3),
      city('six-hundred-k', 600_000, 0, 4),
      city('one-point-two-m', 1_200_000, 0, 5),
    ];
    expect(recordHolders(0, cities).map(({ index }) => index)).toEqual([
      2, 4, 5,
    ]);
  });

  it('agrees with brute force on 200 seeded fixtures and every alpha step', () => {
    for (let fixture = 0; fixture < 200; fixture += 1) {
      const cities = randomFixture(fixture + 1);
      const holders = recordHolders(0, cities);
      for (let step = 10; step <= 100; step += 1) {
        const alpha = step / 100;
        const expected = nearestByBruteForce(0, cities, alpha);
        const actual = competitorAt(
          holders,
          cities.map(({ population }) => population),
          cities[0]!.population,
          alpha,
        );
        if (expected === null) {
          expect(actual).toBeNull();
        } else {
          expect(actual).toEqual({
            index: expected.index,
            distanceKm: expected.distanceKm,
          });
        }
      }
    }
  });

  it('produces a non-decreasing radius as alpha increases', () => {
    for (let fixture = 0; fixture < 200; fixture += 1) {
      const cities = randomFixture(fixture + 1);
      const holders = recordHolders(0, cities);
      let previous = 0;
      for (let step = 10; step <= 100; step += 1) {
        const competitor = competitorAt(
          holders,
          cities.map(({ population }) => population),
          cities[0]!.population,
          step / 100,
        );
        const radius = competitor?.distanceKm ?? Number.POSITIVE_INFINITY;
        expect(radius).toBeGreaterThanOrEqual(previous);
        previous = radius;
      }
    }
  });

  it('resolves distance ties by population and then source id', () => {
    const populationTie = [
      city('focal', 1_000_000, 0, 0),
      city('small', 100_000, 0, 1),
      city('large', 200_000, 0, -1),
    ];
    expect(
      competitorAt(
        recordHolders(0, populationTie),
        populationTie.map((item) => item.population),
        1_000_000,
        0.1,
      )?.index,
    ).toBe(2);

    const idTie = [
      city('focal', 1_000_000, 0, 0),
      city('z-city', 200_000, 0, 0),
      city('a-city', 200_000, 0, 0),
    ];
    expect(
      competitorAt(
        recordHolders(0, idTie),
        idTie.map((item) => item.population),
        1_000_000,
        0.1,
      )?.index,
    ).toBe(2);
  });

  it('treats the threshold as inclusive', () => {
    const cities = [
      city('focal', 1_000_000, 0, 0),
      city('half', 500_000, 0, 1),
    ];
    expect(
      competitorAt(
        recordHolders(0, cities),
        cities.map(({ population }) => population),
        1_000_000,
        0.5,
      )?.index,
    ).toBe(1);
  });

  it('returns null when no city reaches the threshold', () => {
    const cities = [
      city('largest', 2_000_000, 0, 0),
      city('near', 250_000, 0, 1),
    ];
    const holders = recordHolders(0, cities);
    const populations = cities.map(({ population }) => population);
    expect(
      competitorAt(holders, populations, cities[0]!.population, 0.2),
    ).toBeNull();
    expect(
      competitorAt(holders, populations, cities[0]!.population, 0.1)?.index,
    ).toBe(1);
  });

  it('handles the antimeridian as a short crossing', () => {
    const distance = haversineKm(
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 },
    );
    expect(distance).toBeCloseTo(22.2, 0);
    expect(distance).toBeLessThan(100);
  });

  it('handles near-polar and identical coordinates', () => {
    expect(() =>
      haversineKm(
        { latitude: 89.999, longitude: 0 },
        { latitude: 89.999, longitude: 179.999 },
      ),
    ).not.toThrow();
    expect(
      haversineKm(
        { latitude: 89.999, longitude: 0 },
        { latitude: 89.999, longitude: 179.999 },
      ),
    ).toBeGreaterThan(0);
    expect(
      haversineKm({ latitude: 1, longitude: 2 }, { latitude: 1, longitude: 2 }),
    ).toBe(0);
  });

  it('ranks defined focal cities by radius, population, then id', () => {
    const cities = [
      city('focal-a', 1_000_000, 0, 0),
      city('focal-b', 2_000_000, 0, 10),
      city('competitor-a', 500_000, 0, 1),
      city('competitor-b', 1_000_000, 0, 11),
    ];
    const holders = cities.map((_, index) =>
      index < 2 ? recordHolders(index, cities) : null,
    );
    expect(
      rankingAt([0, 1], cities, holders, 0.5).map(({ index }) => index),
    ).toEqual([1, 0]);
  });

  it('clamps and rounds slider values', () => {
    expect(clampAlpha(0.005)).toBe(ALPHA_MIN);
    expect(clampAlpha(1.2)).toBe(ALPHA_MAX);
    expect(clampAlpha(0.374)).toBe(0.37);
    expect(clampAlpha(Number.NaN)).toBe(ALPHA_DEFAULT);
  });

  it('parses URL values with a default for invalid or out-of-range input', () => {
    expect(parseAlphaParam('0.37')).toBe(0.37);
    expect(parseAlphaParam('0.374')).toBe(0.37);
    expect(parseAlphaParam('1')).toBe(1);
    expect(parseAlphaParam('0.1')).toBe(0.1);
    for (const raw of ['5', '0.05', '0.099', '-1', 'abc', '']) {
      expect(parseAlphaParam(raw)).toBe(ALPHA_DEFAULT);
    }
    expect(parseAlphaParam(null)).toBe(ALPHA_DEFAULT);
  });
});
