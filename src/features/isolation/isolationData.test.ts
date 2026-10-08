import { describe, expect, it } from 'vitest';
import {
  decodeIsolationDataset,
  displayIsolationName,
  nearestFocalCity,
} from './isolationData';

const fixture = {
  formatVersion: 1,
  strings: ['Alpha', '阿尔法', 'Country', '国家', 'Beta', 'Gamma'],
  cities: [
    ['a', 0, 1799000, 1000000, 0, 1, 2, 3, true],
    ['b', 0, -1799000, 600000, 4, null, 2, null, false],
    ['c', 100000, 0, 200000, 5, null, 2, null, true],
  ],
  holders: [[[1, 22]], null, [[0, 11120]]],
};

describe('isolation data', () => {
  it('decodes compact rows and holder lists', () => {
    const dataset = decodeIsolationDataset(fixture);
    expect(dataset.cities).toHaveLength(3);
    expect(dataset.focalIndices).toEqual([0, 2]);
    expect(dataset.holders[0]).toEqual([{ index: 1, distanceKm: 22 }]);
    expect(displayIsolationName(dataset.cities[1]!, 'zh')).toBe('Beta');
  });

  it('finds a focal city across the antimeridian', () => {
    const dataset = decodeIsolationDataset(fixture);
    const nearest = nearestFocalCity(
      { latitude: 0, longitude: -179.85 },
      dataset,
    );
    expect(nearest?.index).toBe(0);
    expect(nearest?.distanceKm).toBeLessThan(30);
  });
});
