import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/appStore';
import { parseUrlState, serializeUrlState } from '../../state/urlState';
import { useModePresentation } from '../modes/useModePresentation';
import {
  displayIdRaster,
  sampleReshapedId,
  sampleReshapedPadding,
  sampleReshapedPatchLabel,
  type ReshapedPatchAtlas,
  type ReshapedDataset,
  type ReshapedUnit,
} from './reshapedData';

const initialState = useAppStore.getState();

afterEach(() => {
  cleanup();
  useAppStore.setState(initialState, true);
});

describe('local ID atlas picking', () => {
  const patchAtlas = (): ReshapedPatchAtlas => {
    const width = 70,
      height = 70;
    const patch = {
      countryIds: ['north', 'south'],
      rasterIds: [1, 2],
      groupIndex: 0,
      bbox: [178, -2, 182, 2] as [number, number, number, number],
      width: 66,
      height: 66,
      innerWidth: 64,
      innerHeight: 64,
      transitionWidthPixels: 16,
      transitionBoundaryPixels: 0,
      labelMismatchPixels: 0,
      edgeClearancePixels: 24,
      countryPaddingBits: 3,
      atlas: { x: 2, y: 2, width: 66, height: 66 },
    };
    const raster = {
      width,
      height,
      ids: new Uint32Array(width * height).fill(9),
      padding: new Uint8Array(width * height),
      distance: new Uint8Array(width * height).fill(255),
    };
    for (let y = 0; y < 66; y++)
      for (let x = 0; x < 66; x++) {
        const innerY = Math.min(63, Math.max(0, y - 1));
        const i = (y + 2) * width + x + 2;
        raster.ids[i] = innerY < 32 ? 1 : 2;
        raster.padding[i] = innerY < 32 ? 1 : 2;
        raster.distance[i] = Math.round(
          Math.min(4, Math.abs(innerY + 0.5 - 32)) * 63.75,
        );
      }
    return { width, height, scale: 8, patches: [patch], raster };
  };
  it('uses the common bilinear classifier without a vertical flip or atlas shelf leakage', () => {
    const atlas = patchAtlas();
    expect(sampleReshapedPatchLabel(atlas, 1, 180)?.id).toBe(1);
    expect(sampleReshapedPatchLabel(atlas, -1, -180)?.id).toBe(2);
    expect(sampleReshapedPatchLabel(atlas, 0, 180)).toMatchObject({
      id: 1,
      distance: 0,
      padding: 1,
    });
    expect(sampleReshapedPatchLabel(atlas, 0, -180)).toEqual(
      sampleReshapedPatchLabel(atlas, 0, 180),
    );
    expect(sampleReshapedPatchLabel(atlas, 0, 0)).toBeNull();
  });
  it('switches to the atlas at the half-weight seam and retains the base outside it', () => {
    const atlas = patchAtlas();
    const basePixel = 360 / 4096;
    expect(
      sampleReshapedPatchLabel(atlas, 1, 178 + basePixel * 0.99),
    ).toBeNull();
    expect(sampleReshapedPatchLabel(atlas, 1, 178 + basePixel)).toMatchObject({
      id: 1,
      weight: 0.5,
    });
    expect(
      sampleReshapedPatchLabel(atlas, 1, 178 + basePixel * 2),
    ).toMatchObject({ id: 1, weight: 1 });
  });
});

describe('shared Reshaped Earth display raster', () => {
  it('reduces the saturated distance lower bound along with low-quality bytes', () => {
    const raster = {
      width: 4,
      height: 2,
      ids: new Uint32Array([1, 1, 0, 0, 1, 1, 0, 0]),
      distance: new Uint8Array([255, 255, 255, 255, 64, 255, 255, 254]),
    };
    const low = displayIdRaster(raster, true);
    expect(low.distance).toEqual(new Uint8Array([128, 127]));
    expect(low.distanceCap).toBe(128);
    expect(low.ids).toEqual(new Uint32Array([1, 0]));
  });

  it('keeps country identity separate from the stable padding bits at the seam and after downsampling', () => {
    const raster = {
      width: 4,
      height: 2,
      ids: new Uint32Array([1, 1, 2, 2, 1, 1, 2, 2]),
      padding: new Uint8Array([1, 2, 4, 8, 1, 10, 4, 8]),
    };
    expect(sampleReshapedId(raster, 45, -179)).toBe(1);
    expect(sampleReshapedPadding(raster, 45, -179, 'population')).toBe(true);
    expect(sampleReshapedPadding(raster, 45, -179, 'gdp')).toBe(false);
    expect(sampleReshapedId(raster, 45, 181)).toBe(1);
    const low = displayIdRaster(raster, true);
    expect(low.padding).toEqual(new Uint8Array([10, 8]));
    expect(sampleReshapedId(low, 45, -135)).toBe(1);
    expect(sampleReshapedPadding(low, 45, -135, 'gdp')).toBe(true);
    expect(sampleReshapedPadding(low, 45, -135, 'lights')).toBe(true);
    expect(sampleReshapedPadding(low, 45, -135, 'population')).toBe(false);
  });
  it('keeps a low-quality border selection consistent after URL restoration clears the override', () => {
    const original = {
      width: 4,
      height: 2,
      ids: new Uint32Array([1, 1, 1, 1, 1, 2, 1, 1]),
    };
    const ids = displayIdRaster(original, true);
    const point = { latitude: 45, longitude: -135 };
    expect(sampleReshapedId(original, point.latitude, point.longitude)).toBe(1);
    const displayedId = sampleReshapedId(ids, point.latitude, point.longitude);
    expect(displayedId).toBe(2);
    const units: ReshapedUnit[] = [1, 2].map((rasterId) => ({
      id: rasterId === 1 ? 'ne-156' : 'ne-036',
      rasterId,
      paletteIndex: rasterId,
      name: { en: String(rasterId), zh: String(rasterId) },
      areaKm2: 1,
      representativePoint: null,
    }));
    const dataset: ReshapedDataset = {
      units,
      unitsById: new Map(units.map((unit) => [unit.id, unit])),
      unitsByRasterId: new Map(units.map((unit) => [unit.rasterId, unit])),
      values: new Map(),
      ids,
      inverse: null,
      graphicsUnavailable: false,
      metric: 'population',
    };
    useAppStore.setState({
      activeMode: 'reshaped',
      reshapedMetric: 'population',
      point,
      reshapedSelectedUnitId: units[displayedId - 1]!.id,
    });
    const { result } = renderHook(() =>
      useModePresentation({ status: 'ready', data: dataset, retry: vi.fn() }),
    );
    expect(
      result.current?.id === 'reshaped' && result.current.selectedUnit?.id,
    ).toBe('ne-036');
    const query = serializeUrlState(useAppStore.getState());

    act(() =>
      useAppStore.setState({
        ...parseUrlState(query),
        reshapedSelectedUnitId: undefined,
      }),
    );

    expect(
      result.current?.id === 'reshaped' && result.current.selectedUnit?.id,
    ).toBe('ne-036');
  });
});
