import { describe, expect, it } from 'vitest';
import {
  computeVisibleSurnameSurfaceBounds,
  computeSurnameLabelLayout,
  type SurnameLabelScreenRect,
} from './surnameLabelLayout';

function rect(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  overrides: Partial<SurnameLabelScreenRect> = {},
): SurnameLabelScreenRect {
  return {
    id,
    left,
    right: left + width,
    top,
    bottom: top + height,
    frontFacing: true,
    selected: false,
    ...overrides,
  };
}

describe('surname label layout', () => {
  it('keeps the selected label ahead of overlapping labels', () => {
    const layout = computeSurnameLabelLayout(
      [
        rect('other', 40, 40, 80, 30),
        rect('selected', 40, 40, 80, 30, { selected: true }),
      ],
      [],
      { width: 200, height: 120 },
    );

    expect([...layout.visibleIds]).toEqual(['selected']);
    expect(layout.hiddenReasons.get('other')).toBe('collision');
    expect(layout.selectedVisible).toBe(true);
  });

  it('prefers larger readable labels in a dense region while keeping rectangles disjoint', () => {
    const layout = computeSurnameLabelLayout(
      [
        rect('large', 40, 40, 90, 40),
        rect('small', 80, 60, 20, 12),
        rect('separate', 150, 40, 30, 20),
      ],
      [],
      { width: 200, height: 120 },
    );

    expect([...layout.visibleIds]).toEqual(['large', 'separate']);
    expect(layout.hiddenReasons.get('small')).toBe('collision');
    expect(layout.collisionCount).toBe(1);
  });

  it('rejects back-facing, edge-clipped, invalid, and obstructed labels', () => {
    const layout = computeSurnameLabelLayout(
      [
        rect('back', 20, 20, 20, 10, { frontFacing: false }),
        rect('edge', 0, 20, 20, 10),
        rect('invalid', Number.NaN, 20, 20, 10),
        rect('obstacle', 70, 20, 20, 10),
        rect('safe', 20, 70, 20, 10),
      ],
      [{ left: 60, right: 100, top: 10, bottom: 60 }],
      { width: 120, height: 100 },
    );

    expect([...layout.visibleIds]).toEqual(['edge', 'safe']);
    expect(layout.hiddenReasons.get('back')).toBe('backface');
    expect(layout.hiddenReasons.has('edge')).toBe(false);
    expect(layout.hiddenReasons.get('invalid')).toBe('invalid');
    expect(layout.hiddenReasons.get('obstacle')).toBe('obstacle');
  });

  it('keeps a selected label when at least a quarter remains visible', () => {
    const layout = computeSurnameLabelLayout(
      [rect('selected', 190, 40, 30, 20, { selected: true })],
      [],
      { width: 200, height: 120 },
    );
    expect(layout.selectedVisible).toBe(true);
  });

  it('clips a curved surface envelope at the horizon instead of using back vertices', () => {
    const bounds = computeVisibleSurnameSurfaceBounds(
      [
        { x: 0, y: 0, visibility: 1 },
        { x: 10, y: 0, visibility: -1 },
        { x: 0, y: 10, visibility: 1 },
        { x: 100, y: 100, visibility: -1 },
      ],
      [{ a: 0, b: 1, c: 2 }],
    );
    expect(bounds).toMatchObject({
      left: 0,
      right: 5,
      top: 0,
      bottom: 10,
    });
    expect(bounds?.right).toBeLessThan(100);
  });

  it('returns no bounds when every curved-surface vertex is behind the globe', () => {
    expect(
      computeVisibleSurnameSurfaceBounds(
        [
          { x: 0, y: 0, visibility: -1 },
          { x: 10, y: 0, visibility: -1 },
          { x: 0, y: 10, visibility: -1 },
        ],
        [{ a: 0, b: 1, c: 2 }],
      ),
    ).toBeNull();
  });
});
