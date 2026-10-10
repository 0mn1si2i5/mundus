import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/appStore';
import { parseUrlState, serializeUrlState } from '../../state/urlState';
import { useModePresentation } from '../modes/useModePresentation';
import {
  displayIdRaster,
  sampleReshapedId,
  type ReshapedDataset,
  type ReshapedUnit,
} from './reshapedData';

const initialState = useAppStore.getState();

afterEach(() => {
  cleanup();
  useAppStore.setState(initialState, true);
});

describe('shared Reshaped Earth display raster', () => {
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
      id: `ne-156:${rasterId}`,
      rasterId,
      paletteIndex: rasterId,
      level: 'admin1',
      parentCountryId: 'ne-156',
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
      level: 'admin1',
    };
    useAppStore.setState({
      activeMode: 'reshaped',
      reshapedMetric: 'population',
      reshapedLevel: 'admin1',
      point,
      reshapedSelectedUnitId: units[displayedId - 1]!.id,
    });
    const { result } = renderHook(() =>
      useModePresentation({ status: 'ready', data: dataset, retry: vi.fn() }),
    );
    expect(
      result.current?.id === 'reshaped' && result.current.selectedUnit?.id,
    ).toBe('ne-156:2');
    const query = serializeUrlState(useAppStore.getState());

    act(() =>
      useAppStore.setState({
        ...parseUrlState(query),
        reshapedSelectedUnitId: undefined,
      }),
    );

    expect(
      result.current?.id === 'reshaped' && result.current.selectedUnit?.id,
    ).toBe('ne-156:2');
  });
});
