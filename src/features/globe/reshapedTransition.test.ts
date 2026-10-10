import { describe, expect, it } from 'vitest';
import type { InverseField } from '../reshaped/inverseFormat.mjs';
import { MORPH_DURATION_MS } from '../reshaped/reshapedMapping';
import { ReshapedTransition } from './reshapedTransition';

const field = (): InverseField => ({
  width: 8,
  height: 4,
  encoding: 'regular-node-float32',
  data: new Float32Array(9 * 5 * 2),
});

function setup() {
  const live = new Set<InverseField>();
  const disposed: InverseField[] = [];
  let peak = 0;
  const transition = new ReshapedTransition(
    (value) => {
      live.add(value);
      peak = Math.max(peak, live.size);
      return value;
    },
    (value) => {
      expect(live.delete(value)).toBe(true);
      disposed.push(value);
    },
  );
  return { transition, live, disposed, peak: () => peak };
}

describe('country measure transitions', () => {
  it('holds the completed field during loading, morphs from it, and disposes it at settlement', () => {
    const { transition, live, disposed, peak } = setup();
    const population = field(),
      gdp = field();
    transition.sync(population, 'reshaped', 'population', 0, false, 0);
    transition.tick(MORPH_DURATION_MS);
    transition.sync(population, 'reshaped', 'gdp', 0, false, 2000);
    expect(transition.mapping).toEqual({ from: null, to: population, t: 1 });
    expect(transition.active).toBe(false);
    transition.sync(gdp, 'reshaped', 'gdp', 0, false, 3000);
    expect(transition.mapping).toEqual({ from: population, to: gdp, t: 0 });
    transition.tick(3000 + MORPH_DURATION_MS / 2);
    expect(transition.mapping.t).toBe(0.5);
    expect(live.size).toBe(2);
    transition.tick(3000 + MORPH_DURATION_MS);
    expect(transition.mapping).toEqual({ from: null, to: gdp, t: 1 });
    expect(disposed).toEqual([population]);
    expect(live.size).toBe(1);
    expect(peak()).toBe(2);
    transition.dispose();
    expect(live.size).toBe(0);
  });

  it('snaps an interrupted metric morph to its destination before loading the next field', () => {
    const { transition, live, disposed, peak } = setup();
    const population = field(),
      gdp = field(),
      lights = field();
    transition.sync(population, 'reshaped', 'population', 0, true, 0);
    transition.sync(gdp, 'reshaped', 'gdp', 0, false, 100);
    transition.tick(400);
    transition.sync(gdp, 'reshaped', 'lights', 0, false, 500);
    expect(transition.mapping).toEqual({ from: null, to: gdp, t: 1 });
    expect(disposed).toEqual([population]);
    transition.sync(lights, 'reshaped', 'lights', 0, false, 600);
    expect(transition.mapping).toEqual({ from: gdp, to: lights, t: 0 });
    expect(peak()).toBe(2);
    transition.dispose();
    expect(live.size).toBe(0);
    expect(disposed).toEqual([population, gdp, lights]);
  });

  it('retains true shape during a metric load and applies reduced motion and replay immediately', () => {
    const { transition, live } = setup();
    const population = field(),
      gdp = field();
    transition.sync(population, 'true', 'population', 0, false, 0);
    transition.sync(gdp, 'true', 'gdp', 0, false, 100);
    expect(transition.mapping).toEqual({ from: null, to: gdp, t: 0 });
    expect(live.size).toBe(1);
    transition.sync(gdp, 'reshaped', 'gdp', 1, true, 200);
    expect(transition.mapping.t).toBe(1);
    expect(transition.active).toBe(false);
    transition.dispose();
    expect(live.size).toBe(0);
  });
});
