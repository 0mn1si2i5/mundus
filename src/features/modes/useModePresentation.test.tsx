import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/appStore';
import type { ReshapedDataset } from '../reshaped/reshapedData';
import {
  getRankOneSurnameRecord,
  loadSurnameDataset,
} from '../surnames/surnameData';
import { resolveSurnameWordmark } from '../surnames/surnameWordmark';
import {
  useModePresentation,
  useGlobePresentation,
  useSharedReshapedData,
} from './useModePresentation';

const { loadReshapedData } = vi.hoisted(() => ({ loadReshapedData: vi.fn() }));
vi.mock('../reshaped/reshapedData', () => ({ loadReshapedData }));
const initialState = useAppStore.getState();

afterEach(() => {
  cleanup();
  useAppStore.setState(initialState, true);
});

describe('useGlobePresentation', () => {
  beforeEach(() => {
    loadReshapedData.mockReset();
    useAppStore.setState({
      activeMode: null,
      point: { latitude: 31.2304, longitude: 121.4737 },
      selectedCountry: null,
      sunlineTimeMs: Date.parse('2026-07-14T09:37:00Z'),
    });
  });

  it('returns a neutral globe in the lobby without loading mode resources', () => {
    const { result } = renderHook(() => useGlobePresentation());
    expect(result.current).toEqual({
      showAntipodes: false,
      sunline: null,
      antipodeRelation: null,
      mapWordmarks: [],
      wordmarkKey: '',
      isolation: null,
      reshaped: null,
      countryColors: null,
      circle: null,
      climate: null,
    });
    expect(loadReshapedData).not.toHaveBeenCalled();
  });

  it('turns on the antipode presentation only in Other Side', () => {
    useAppStore.setState({ activeMode: 'antipodes' });
    const { result } = renderHook(() => useGlobePresentation());
    expect(result.current.showAntipodes).toBe(true);
    expect(result.current.sunline).toBeNull();
  });

  it('produces a solar presentation for Sunline without throwing', () => {
    useAppStore.setState({ activeMode: 'sunline' });
    const { result } = renderHook(() => useGlobePresentation());
    expect(result.current.showAntipodes).toBe(false);
    expect(result.current.sunline).not.toBeNull();
    expect(result.current.sunline?.subsolarPoint).toBeDefined();
  });

  it('emits ranked and explicitly source-listed map records', async () => {
    useAppStore.setState({
      activeMode: 'surnames',
      selectedCountry: { countryId: 'ne-300', name: 'Greece' },
    });
    const { result } = renderHook(() => useGlobePresentation());

    await waitFor(() => expect(result.current.mapWordmarks).toHaveLength(197));
    expect(
      result.current.mapWordmarks.some((label) => label.countryId === 'ne-300'),
    ).toBe(true);
    const dataset = await loadSurnameDataset();
    const rankOne = getRankOneSurnameRecord(
      dataset.countriesById.get('ne-156'),
    );
    expect(rankOne?.rank).toBe(1);
    expect(
      result.current.mapWordmarks.find((label) => label.countryId === 'ne-156')
        ?.wordmark,
    ).toEqual(resolveSurnameWordmark(rankOne!, 'local'));
    expect(result.current.wordmarkKey).toBe('surnames:local');
  });
});

describe('Literal Names globe presentation', () => {
  it('writes a literal wordmark for every country and follows the label', async () => {
    useAppStore.setState({ activeMode: 'names', locale: 'en' });
    const { result } = renderHook(() => useGlobePresentation());

    await waitFor(() => expect(result.current.mapWordmarks).toHaveLength(239));
    expect(result.current.wordmarkKey).toBe('names:literal:en');
    expect(
      result.current.mapWordmarks.find((label) => label.countryId === 'ne-352')
        ?.wordmark?.value,
    ).toBe('Land of Ice');

    act(() => useAppStore.getState().setNamesLabel('local'));
    expect(result.current.wordmarkKey).toBe('names:local:en');
    expect(
      result.current.mapWordmarks.find((label) => label.countryId === 'ne-352')
        ?.wordmark?.value,
    ).toBe('Ísland');
  });
});

describe('current Reshaped Earth field', () => {
  beforeEach(() => {
    loadReshapedData.mockReset();
  });

  it('uses the semantic country selection when a low-quality raster samples ocean', () => {
    const unit = {
      id: 'ne-048',
      rasterId: 48,
      name: { en: 'Bahrain', zh: '巴林' },
      areaKm2: 1,
      representativePoint: null,
      paletteIndex: 1,
    };
    const value = {
      id: unit.id,
      values: { population: 1, gdp: null, co2: null, lights: null },
      worldShare: { population: 1, gdp: null, co2: null, lights: null },
      areaRatio: { population: 1, gdp: null, co2: null, lights: null },
      year: 2020,
    };
    const dataset = {
      metric: 'population',
      units: [unit],
      unitsById: new Map([[unit.id, unit]]),
      unitsByRasterId: new Map([[unit.rasterId, unit]]),
      values: new Map([[unit.id, value]]),
      ids: { width: 1, height: 1, ids: new Uint32Array([0]) },
      inverse: null,
      graphicsUnavailable: false,
    } satisfies ReshapedDataset;
    useAppStore.setState({
      activeMode: 'reshaped',
      point: { latitude: 26.2822, longitude: 50.6152 },
      selectedCountry: { countryId: unit.id, name: 'Bahrain' },
      reshapedMetric: 'population',
    });
    const { result } = renderHook(() =>
      useModePresentation({
        status: 'ready',
        data: dataset,
        retry: vi.fn(),
      }),
    );
    expect(result.current?.id).toBe('reshaped');
    expect(
      result.current?.id === 'reshaped' && result.current.selectedUnit,
    ).toBe(unit);
  });

  it('keeps the previous metric during loading and rejects an aborted late response', async () => {
    const requests: {
      signal: AbortSignal;
      resolve: (data: ReshapedDataset) => void;
    }[] = [];
    loadReshapedData.mockImplementation(
      (_metric: string, signal: AbortSignal) =>
        new Promise<ReshapedDataset>((resolve) =>
          requests.push({ signal, resolve }),
        ),
    );
    const dataset = (metric: ReshapedDataset['metric']): ReshapedDataset => ({
      metric,
      units: [],
      unitsById: new Map(),
      unitsByRasterId: new Map(),
      values: new Map(),
      ids: null,
      inverse: null,
      graphicsUnavailable: false,
    });
    useAppStore.setState({
      activeMode: 'reshaped',
      reshapedMetric: 'population',
    });
    const { result } = renderHook(useSharedReshapedData);
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0]!.resolve(dataset('population')));
    expect(result.current.data?.metric).toBe('population');

    act(() => useAppStore.getState().setReshapedMetric('gdp'));
    expect(result.current.status).toBe('loading');
    expect(result.current.data?.metric).toBe('population');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(loadReshapedData.mock.calls[1]![2]).toBe(result.current.data);
    expect(requests[0]!.signal.aborted).toBe(true);
    act(() => useAppStore.getState().setReshapedMetric('lights'));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[1]!.signal.aborted).toBe(true);
    await act(async () => requests[1]!.resolve(dataset('gdp')));
    expect(result.current.data?.metric).toBe('population');
    await act(async () => requests[2]!.resolve(dataset('lights')));
    expect(result.current.status).toBe('ready');
    expect(result.current.data?.metric).toBe('lights');
  });

  it('removes the preceding map on load failure and releases it on mode exit', async () => {
    const population = {
      metric: 'population',
      units: [],
      unitsById: new Map(),
      unitsByRasterId: new Map(),
      values: new Map(),
      ids: null,
      inverse: null,
      graphicsUnavailable: false,
    } satisfies ReshapedDataset;
    loadReshapedData.mockResolvedValueOnce(population);
    loadReshapedData.mockRejectedValueOnce(new Error('offline'));
    useAppStore.setState({
      activeMode: 'reshaped',
      reshapedMetric: 'population',
    });
    const { result } = renderHook(useSharedReshapedData);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => useAppStore.getState().setReshapedMetric('gdp'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeUndefined();
    loadReshapedData.mockResolvedValueOnce(population);
    act(() => useAppStore.getState().setReshapedMetric('population'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => useAppStore.setState({ activeMode: 'antipodes' }));
    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeUndefined();
    await act(async () => {});
    loadReshapedData.mockResolvedValueOnce(population);
    act(() => useAppStore.setState({ activeMode: 'reshaped' }));
    await waitFor(() => expect(loadReshapedData).toHaveBeenCalledTimes(4));
    expect(loadReshapedData.mock.calls[3]![2]).toBeUndefined();
  });
});
