import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/appStore';
import type { ReshapedDataset } from '../reshaped/reshapedData';
import {
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
      surnameMapLabels: [],
      surnameDisplayMode: 'local',
      isolation: null,
      reshaped: null,
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

    await waitFor(() =>
      expect(result.current.surnameMapLabels).toHaveLength(197),
    );
    expect(
      result.current.surnameMapLabels.some(
        (label) => label.countryId === 'ne-300',
      ),
    ).toBe(true);
    expect(
      result.current.surnameMapLabels.find(
        (label) => label.countryId === 'ne-156',
      )?.record.rank,
    ).toBe(1);
  });
});

describe('current Reshaped Earth field', () => {
  beforeEach(() => {
    loadReshapedData.mockReset();
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
