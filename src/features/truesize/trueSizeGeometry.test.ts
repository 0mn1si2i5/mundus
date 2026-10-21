import { describe, expect, it } from 'vitest';
import { geoArea, geoCentroid, geoDistance } from 'd3-geo';
import type { Polygon } from 'geojson';
import {
  areaKm2,
  mercatorInflation,
  placeGeometry,
  trueSizeAnchor,
  trueSizeRotation,
} from './trueSizeGeometry';
import {
  TRUE_SIZE_DEFAULT_COUNTRY,
  countryAreaKm2,
  isTrueSizeCountry,
  parseTrueSizeCountryParam,
  placeTrueSizeCountry,
  trueSizeCountryIds,
} from './trueSize';

const square: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [10, 60],
      [10, 70],
      [30, 70],
      [30, 60],
      [10, 60],
    ],
  ],
};

describe('True Size rotation', () => {
  it('moves the anchor exactly onto the target', () => {
    const rotate = trueSizeRotation(
      { latitude: 72, longitude: -40 },
      { latitude: -12.5, longitude: 121 },
    );
    const [longitude, latitude] = rotate([-40, 72]);
    expect(longitude).toBeCloseTo(121, 9);
    expect(latitude).toBeCloseTo(-12.5, 9);
  });

  it('keeps north up along the target meridian', () => {
    const rotate = trueSizeRotation(
      { latitude: 60, longitude: 20 },
      { latitude: 0, longitude: 100 },
    );
    const [longitude, latitude] = rotate([20, 61]);
    expect(longitude).toBeCloseTo(100, 9);
    expect(latitude).toBeCloseTo(1, 9);
  });

  it('preserves area and edge lengths wherever the shape goes', () => {
    const anchor = trueSizeAnchor(square);
    for (const target of [
      { latitude: 0, longitude: 0 },
      { latitude: -80, longitude: 179.9 },
      { latitude: 45, longitude: -170 },
    ]) {
      const placed = placeGeometry(square, anchor, target);
      expect(geoArea(placed.geometry)).toBeCloseTo(geoArea(square), 10);
      const ring = placed.geometry.coordinates[0]![0]!;
      const original = square.coordinates[0]!;
      for (let i = 0; i < 4; i += 1)
        expect(
          geoDistance(
            ring[i] as [number, number],
            ring[i + 1] as [number, number],
          ),
        ).toBeCloseTo(
          geoDistance(
            original[i] as [number, number],
            original[i + 1] as [number, number],
          ),
          10,
        );
      const [lon, lat] = geoCentroid(placed.geometry);
      expect(lat).toBeCloseTo(target.latitude, 6);
      expect(
        Math.abs(((lon - target.longitude + 540) % 360) - 180),
      ).toBeLessThan(1e-6);
    }
  });

  it('densifies outline rings to steps of at most one degree', () => {
    const placed = placeGeometry(square, trueSizeAnchor(square), {
      latitude: 0,
      longitude: 0,
    });
    const ring = placed.rings[0]!;
    for (let i = 0; i < ring.length - 1; i += 1)
      expect(
        geoDistance(
          ring[i] as [number, number],
          ring[i + 1] as [number, number],
        ),
      ).toBeLessThanOrEqual((Math.PI / 180) * 1.0001);
  });
});

describe('True Size measures', () => {
  it('measures spherical area in km²', () => {
    // A 1°×1° cell at the equator is about 12,364 km².
    const cell: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    };
    expect(areaKm2(cell)).toBeCloseTo(12364, -1);
  });

  it('reports Mercator inflation of about sec² latitude', () => {
    const at = (latitude: number): Polygon => ({
      type: 'Polygon',
      coordinates: [
        [
          [0, latitude - 0.5],
          [0, latitude + 0.5],
          [1, latitude + 0.5],
          [1, latitude - 0.5],
          [0, latitude - 0.5],
        ],
      ],
    });
    expect(mercatorInflation(at(0))!).toBeCloseTo(1, 3);
    expect(mercatorInflation(at(60))!).toBeCloseTo(4, 1);
    expect(mercatorInflation(at(89))).toBeNull();
  });
});

describe('True Size country placement', () => {
  it('uses Greenland as the default and validates ids', () => {
    expect(TRUE_SIZE_DEFAULT_COUNTRY).toBe('ne-304');
    expect(isTrueSizeCountry('ne-304')).toBe(true);
    expect(isTrueSizeCountry('ne-999')).toBe(false);
    expect(isTrueSizeCountry(null)).toBe(false);
    expect(parseTrueSizeCountryParam('nope')).toBe('ne-304');
    expect(parseTrueSizeCountryParam('ne-156')).toBe('ne-156');
    expect(trueSizeCountryIds().size).toBeGreaterThan(150);
  });

  it('gives Greenland its well-known size and Mercator exaggeration', () => {
    const greenland = placeTrueSizeCountry('ne-304', {
      latitude: 0,
      longitude: 20,
    })!;
    // Official area about 2.17 million km²; the 1:110m outline is close.
    expect(greenland.areaKm2).toBeGreaterThan(2.0e6);
    expect(greenland.areaKm2).toBeLessThan(2.3e6);
    expect(greenland.homeInflation!).toBeGreaterThan(5);
    expect(greenland.placedInflation!).toBeLessThan(1.5);
    expect(geoArea(greenland.placed.geometry)).toBeCloseTo(
      greenland.areaKm2 / 6371.0088 ** 2,
      8,
    );
  });

  it('places Africa-sized countries without losing area', () => {
    const area = countryAreaKm2('ne-076')!;
    const brazil = placeTrueSizeCountry('ne-076', {
      latitude: 55,
      longitude: 37,
    })!;
    expect(brazil.areaKm2).toBeCloseTo(area, 3);
    expect(brazil.areaKm2).toBeGreaterThan(8.0e6);
    expect(brazil.areaKm2).toBeLessThan(8.9e6);
    expect(brazil.placedInflation!).toBeGreaterThan(2);
  });

  it('returns null for an unknown country', () => {
    expect(placeTrueSizeCountry('ne-999', { latitude: 0, longitude: 0 })).toBe(
      null,
    );
  });
});
