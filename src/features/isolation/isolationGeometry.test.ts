import { describe, expect, it } from 'vitest';
import { haversineKm } from './isolationMetric';
import { greatCircleArcPoints, smallCirclePoints } from './isolationGeometry';

function angularDistance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  return haversineKm(a, b) / 6371.0088;
}

describe('isolation geometry', () => {
  it('builds a closed small circle at the requested angular radius', () => {
    const center = { latitude: 20, longitude: 179.99 };
    const radius = 0.4;
    const points = smallCirclePoints(center, radius, 32);
    expect(points).toHaveLength(33);
    expect(points[0]).toEqual(points.at(-1));
    for (const point of points)
      expect(angularDistance(center, point)).toBeCloseTo(radius, 9);
  });

  it('handles the North Pole', () => {
    const center = { latitude: 90, longitude: 0 };
    for (const point of smallCirclePoints(center, 0.2, 24))
      expect(angularDistance(center, point)).toBeCloseTo(0.2, 9);
  });

  it('samples a short arc with exact endpoints and leaves antipodes empty', () => {
    const a = { latitude: 10, longitude: 179.9 };
    const b = { latitude: -10, longitude: -179.9 };
    const points = greatCircleArcPoints(a, b, 16);
    expect(points[0]).toEqual(a);
    expect(points.at(-1)).toEqual(b);
    expect(
      greatCircleArcPoints(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 180 },
      ),
    ).toEqual([]);
  });
});
