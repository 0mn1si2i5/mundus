import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/appStore';
import { parseUrlState, serializeUrlState } from '../../state/urlState';
import { useModePresentation } from '../modes/useModePresentation';
import {
  displayIdRaster,
  sampleReshapedId,
  sampleReshapedPadding,
  type ReshapedDataset,
  type ReshapedUnit,
} from './reshapedData';

const initialState = useAppStore.getState();

afterEach(() => {
  cleanup();
  useAppStore.setState(initialState, true);
});

describe('shared Reshaped Earth display raster', () => {
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
