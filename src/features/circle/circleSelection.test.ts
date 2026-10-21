import { describe, expect, it } from 'vitest';
import { prepareCells } from './circleProfile.mjs';
import { computeCircleSelection } from './circleSelection';
import type { CircleDataset } from './circleData';

function dataset(): CircleDataset {
  const width = 360;
  const height = 180;
  const counts = new Uint32Array(width * height);
  // Two towns of 300 and 100 people, about 1,110 km apart on the equator.
  counts[89 * width + 180] = 300;
  counts[89 * width + 190] = 100;
  const cells = prepareCells(counts, width, height);
  return {
    width,
    height,
    cells,
    displayDensity: new Uint8Array(width * height),
    total: cells.total,
    year: 2020,
    smallest: {
      point: { latitude: 0.5, longitude: 0.5 },
      radiusKm: 1,
      population: 200,
    },
  };
}

describe('circle selection', () => {
  it('reports the half circle by default', () => {
    const selection = computeCircleSelection(
      dataset(),
      { latitude: 0.5, longitude: 0.5 },
      null,
    );
    expect(selection.radiusKm).toBe(selection.halfRadiusKm);
    expect(selection.halfRadiusKm).toBeLessThan(1);
    expect(selection.population).toBe(200);
    expect(selection.share).toBe(0.5);
    expect(selection.milestones.map((m) => m.share)).toEqual([
      0.1, 0.25, 0.5, 0.75, 0.9,
    ]);
    expect(selection.milestones.at(-1)!.radiusKm).toBeGreaterThan(1100);
  });

  it('counts the people inside a chosen radius', () => {
    const near = computeCircleSelection(
      dataset(),
      { latitude: 0.5, longitude: 0.5 },
      500,
    );
    expect(near.population).toBe(300);
    expect(near.share).toBe(0.75);
    const far = computeCircleSelection(
      dataset(),
      { latitude: 0.5, longitude: 0.5 },
      1500,
    );
    expect(far.population).toBe(400);
    expect(far.share).toBe(1);
  });
});
