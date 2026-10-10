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
  data: new Float32Array(8 * 4 * 2),
};
for (let y = 0; y < 4; y += 1)
  for (let x = 0; x < 8; x += 1) {
    field.data[(y * 8 + x) * 2] = 3 * Math.sin(((x + 0.5) / 8) * Math.PI * 2);
    field.data[(y * 8 + x) * 2 + 1] =
      0.025 * Math.cos(((y + 0.5) / 4) * Math.PI);
  }
describe('cartogram mapping', () => {
  it('keeps identity and longitude seam continuous', () => {
    expect(
      inversePoint(
        { longitude: 179, latitude: 30 },
        { from: null, to: null, t: 1 },
      ),
    ).toEqual({ longitude: 179, latitude: 29.999999999999996 });
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
  it('uses adaptive tree branches, quantized corners and the shared build sampler', () => {
    const tree = new Uint32Array(36);
    const corners = new Int16Array(35 * 8);
    const writeCorners = (leaf: number, x: number, y: number, size: number) => {
      for (let q = 0; q < 4; q += 1) {
        const longitude = (x + (q % 2) * size) / 8;
        const latitudeS = (y + Math.floor(q / 2) * size) / 4;
        corners[leaf * 8 + q * 2] = Math.round(
          30000 * Math.sin(longitude * 2 * Math.PI),
        );
        corners[leaf * 8 + q * 2 + 1] = Math.round(
          25000 * Math.sin(latitudeS * Math.PI),
        );
      }
    };
    for (let y = 0; y < 4; y += 1)
      for (let x = 0; x < 8; x += 1) {
        const leaf = y * 8 + x;
        tree[leaf] = (0x80000000 | leaf) >>> 0;
        if (leaf !== 0) writeCorners(leaf, x, y, 1);
      }
    tree[0] = 32;
    for (let q = 0; q < 4; q += 1) {
      const leaf = q === 0 ? 0 : 31 + q;
      tree[32 + q] = (0x80000000 | leaf) >>> 0;
      writeCorners(leaf, (q % 2) * 0.5, Math.floor(q / 2) * 0.5, 0.5);
    }
    const adaptive: InverseField = {
      encoding: 'adaptive-quadtree-int16',
      width: 8,
      height: 4,
      tree,
      corners,
      header: {
        formatVersion: 2,
        metric: 'population',
        level: 'country',
        stepLongitude: 0.0001,
        stepS: 0.000001,
      },
    };
    for (const longitude of [
      -180, -179.999, -170, -157.5, -90, 0, 179.999, 180,
    ])
      for (const latitude of [-90, -85, -20, 0, 55, 85, 90]) {
        const s = Math.sin((latitude * Math.PI) / 180);
        expect(sampleDisplacement(adaptive, longitude, s)).toEqual(
          sampleInverseDisplacement(
            adaptive,
            (longitude + 180) / 360,
            (s + 1) / 2,
          ),
        );
        for (const t of [0, 0.25, 0.5, 1]) {
          const mapping = { from: null, to: adaptive, t };
          const original = {
            longitude: longitude === 180 ? -180 : longitude,
            latitude,
          };
          const displayed = forwardPoint(
            inversePoint(original, mapping),
            mapping,
          );
          expect(displayed.longitude).toBeCloseTo(original.longitude, 5);
          expect(displayed.latitude).toBeCloseTo(original.latitude, 5);
        }
      }
  });
});
