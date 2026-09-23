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
});
