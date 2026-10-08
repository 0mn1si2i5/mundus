import { describe, expect, it } from 'vitest';
import asset from '../../data/generated/urban-isolation.json';
import { decodeIsolationDataset, nearestFocalCity } from './isolationData';
import {
  buildIsolationFieldTable,
  createIsolationFieldSites,
  fieldDirection,
  fieldTileCandidates,
  isolationFieldOwner,
  isolationFieldSelection,
  type IsolationFieldSite,
} from './isolationField';

const dataset = decodeIsolationDataset(asset);
const site = (
  cityIndex: number,
  longitude: number,
  radiusKm: number,
): IsolationFieldSite => ({
  cityIndex,
  id: String(cityIndex),
  point: { latitude: 0, longitude },
  radiusKm,
  direction: fieldDirection({ latitude: 0, longitude }),
});

describe('weighted isolation regions', () => {
  it('assigns a point to the minimum distance/radius, even beyond a nearer centre', () => {
    const sites = [site(0, 0, 100), site(1, 10, 1000)];
    expect(isolationFieldOwner({ latitude: 0, longitude: 2 }, sites)).toBe(1);
    expect(isolationFieldOwner(sites[0]!.point, sites)).toBe(0);
    expect(isolationFieldOwner({ latitude: 0, longitude: 0 }, [])).toBeNull();
    expect(
      isolationFieldOwner({ latitude: 0, longitude: 5 }, [
        site(0, 0, 100),
        site(1, 10, 100),
      ]),
    ).toBe(0);
  });

  it('changes weights with alpha and keeps undefined-radius centres selectable', () => {
    const low = createIsolationFieldSites(dataset, 0.1);
    const high = createIsolationFieldSites(dataset, 1);
    expect(low).toHaveLength(dataset.focalIndices.length);
    expect(high).toHaveLength(dataset.focalIndices.length - 1);
    expect(
      high.some(
        (s) => s.radiusKm !== low.find((other) => other.id === s.id)?.radiusKm,
      ),
    ).toBe(true);
    const largestIndex = dataset.focalIndices.reduce((a, b) =>
      dataset.cities[a]!.population > dataset.cities[b]!.population ? a : b,
    );
    expect(high.some((s) => s.cityIndex === largestIndex)).toBe(false);
    expect(
      isolationFieldSelection(
        dataset.cities[largestIndex]!.point,
        dataset,
        high,
      ),
    ).toBe(largestIndex);
    expect(high.every((s) => s.radiusKm > 0)).toBe(true);
    let weightedDiffersFromNearest = false;
    for (
      let latitude = -80;
      latitude <= 80 && !weightedDiffersFromNearest;
      latitude += 5
    ) {
      for (let longitude = -180; longitude < 180; longitude += 5) {
        const sample = { latitude, longitude };
        expect(isolationFieldSelection(sample, dataset, low)).toBe(
          isolationFieldOwner(sample, low),
        );
        if (
          isolationFieldOwner(sample, low) !==
          nearestFocalCity(sample, dataset)?.index
        )
          weightedDiffersFromNearest = true;
      }
    }
    expect(weightedDiffersFromNearest).toBe(true);
  });

  for (const alpha of [0.1, 0.5, 1]) {
    it(`retains the brute-force winner in every sampled tile at alpha ${alpha}`, () => {
      const sites = createIsolationFieldSites(dataset, alpha);
      const table = buildIsolationFieldTable(sites);
      let seed = 74321;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      const points = [
        { latitude: 90, longitude: 180 },
        { latitude: -90, longitude: -180 },
        { latitude: 89.999, longitude: 179.999 },
        { latitude: -89.999, longitude: -179.999 },
        ...sites.map((s) => s.point),
        ...Array.from({ length: 2000 }, () => ({
          latitude: random() * 180 - 90,
          longitude: random() * 360 - 180,
        })),
      ];
      for (const point of points) {
        const winner = isolationFieldOwner(point, sites);
        const candidates = fieldTileCandidates(point, table).map(
          (index) => sites[index]!,
        );
        expect(
          isolationFieldOwner(point, candidates),
          JSON.stringify(point),
        ).toBe(winner);
      }
      expect(table.maxCandidates).toBeLessThan(sites.length);
      expect(() => buildIsolationFieldTable([])).toThrow('No cities');
    });
  }
});
