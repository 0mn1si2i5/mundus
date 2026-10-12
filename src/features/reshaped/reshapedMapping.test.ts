import { describe, expect, it } from 'vitest';
import {
  forwardPoint,
  inversePoint,
  sampleDisplacement,
} from './reshapedMapping';
import type { InverseField } from './inverseFormat.mjs';
import { sampleInverseDisplacement } from './inverseSampling.mjs';

const field: InverseField = {
  width: 8,
  height: 4,
  encoding: 'regular-node-float32',
  data: new Float32Array(9 * 5 * 2),
};
for (let y = 0; y <= 4; y += 1)
  for (let x = 0; x <= 8; x += 1) {
    field.data[(y * 9 + x) * 2] = 3 * Math.sin((x / 8) * Math.PI * 2);
    field.data[(y * 9 + x) * 2 + 1] =
      y === 0 || y === 4 ? 0 : 0.025 * Math.sin((y / 4) * Math.PI);
  }
describe('cartogram mapping', () => {
  it('keeps identity and longitude seam continuous', () => {
    const identity = inversePoint(
      { longitude: 179, latitude: 30 },
      { from: null, to: null, t: 1 },
    );
    expect(identity.longitude).toBe(179);
    expect(identity.latitude).toBeCloseTo(30, 12);
    const left = sampleDisplacement(field, -180.000001, 0),
      right = sampleDisplacement(field, 179.999999, 0);
    expect(left[0]).toBeCloseTo(right[0], 9);
    expect(left[1]).toBeCloseTo(right[1], 9);
  });
  it('preserves reflecting poles', () => {
    expect(sampleDisplacement(field, 20, 1)[1]).toBe(0);
    expect(sampleDisplacement(field, 20, -1)[1]).toBe(0);
    expect(Math.abs(sampleDisplacement(field, 20, 0.999)[1])).toBeLessThan(
      0.001,
    );
  });
  it('Newton returns the displayed point through the same inverse at every morph stage', () => {
    for (const t of [0, 0.25, 0.5, 1])
      for (const longitude of [-179, -30, 0, 85, 179])
        for (const latitude of [-85, -20, 0, 55, 85]) {
          const mapping = { from: null, to: field, t },
            display = { longitude, latitude };
          const real = inversePoint(display, mapping),
            roundTrip = forwardPoint(real, mapping);
          expect(roundTrip.longitude).toBeCloseTo(longitude, 5);
          expect(roundTrip.latitude).toBeCloseTo(latitude, 5);
        }
  });
  it('uses the shared uniform node sampler at cell edges, the seam and poles', () => {
    for (const longitude of [
      -180, -179.999, -170, -157.5, -90, 0, 179.999, 180,
    ])
      for (const latitude of [-90, -85, -20, 0, 55, 85, 90]) {
        const s = Math.sin((latitude * Math.PI) / 180);
        expect(sampleDisplacement(field, longitude, s)).toEqual(
          sampleInverseDisplacement(
            field,
            (longitude + 180) / 360,
            (s + 1) / 2,
          ),
        );
      }
  });
});
