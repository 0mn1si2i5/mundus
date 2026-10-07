import { describe, expect, it } from 'vitest';
import {
  createSphericalSurnameLabelGeometry,
  createSphericalSurnameLabelPoints,
  SURNAME_LABEL_SURFACE_LIFT,
} from './sphericalSurnameLabel';

describe('spherical surname label geometry', () => {
  it('maps every wordmark vertex outside the globe surface', () => {
    const points = createSphericalSurnameLabelPoints({
      center: { latitude: -10, longitude: -52 },
      angularRadiusDegrees: 14,
      aspectRatio: 0.34,
      rotationDegrees: 0,
      segmentsAlong: 8,
      segmentsAcross: 3,
    });
    expect(points).toHaveLength(36);
    for (const point of points) {
      expect(Math.hypot(...point.position)).toBeGreaterThanOrEqual(
        SURNAME_LABEL_SURFACE_LIFT - 1e-6,
      );
    }
  });

  it('creates a curved indexed surface with stable texture coordinates', () => {
    const geometry = createSphericalSurnameLabelGeometry({
      center: { latitude: 42, longitude: 12 },
      angularRadiusDegrees: 9,
      aspectRatio: 0.34,
      rotationDegrees: 45,
      segmentsAlong: 4,
      segmentsAcross: 2,
    });
    expect(geometry.getAttribute('position').count).toBe(15);
    expect(geometry.getAttribute('uv').count).toBe(15);
    expect(geometry.getIndex()?.count).toBe(48);
    expect(geometry.getAttribute('uv').getY(0)).toBe(0);
    expect(geometry.getAttribute('uv').getY(10)).toBe(1);
    expect(geometry.getAttribute('position').getZ(0)).not.toBe(
      geometry.getAttribute('position').getZ(4),
    );
    geometry.dispose();
  });

  it('keeps every zero-rotation row on one exact latitude', () => {
    const across = 4;
    const along = 8;
    const points = createSphericalSurnameLabelPoints({
      center: { latitude: 38, longitude: 12 },
      angularRadiusDegrees: 18,
      aspectRatio: 0.34,
      rotationDegrees: 0,
      segmentsAlong: along,
      segmentsAcross: across,
    });
    for (let row = 0; row <= across; row += 1) {
      const start = points[row * (along + 1)]!;
      const latitude = Math.asin(
        start.position[1] / SURNAME_LABEL_SURFACE_LIFT,
      );
      for (let column = 1; column <= along; column += 1) {
        const point = points[row * (along + 1) + column]!;
        expect(
          Math.asin(point.position[1] / SURNAME_LABEL_SURFACE_LIFT),
        ).toBeCloseTo(latitude, 10);
      }
    }
  });

  it('keeps high-latitude parallel rows finite and bounded', () => {
    const points = createSphericalSurnameLabelPoints({
      center: { latitude: 89.6, longitude: 12 },
      angularRadiusDegrees: 24,
      aspectRatio: 0.8,
      rotationDegrees: 0,
      segmentsAlong: 12,
      segmentsAcross: 4,
    });
    for (const point of points) {
      expect(point.position.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...point.position)).toBeCloseTo(
        SURNAME_LABEL_SURFACE_LIFT,
        6,
      );
    }
  });
});
