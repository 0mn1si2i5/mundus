import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../state/appStore';
import { useGlobePresentation } from './useModePresentation';

describe('useGlobePresentation', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeMode: null,
      point: { latitude: 31.2304, longitude: 121.4737 },
      selectedCountry: null,
      developmentIndicator: 'hdi',
      developmentYear: 2023,
      sunlineTimeMs: Date.parse('2026-07-14T09:37:00Z'),
    });
  });

  it('returns a neutral globe in the lobby without loading mode resources', () => {
    const { result } = renderHook(() => useGlobePresentation());
    expect(result.current).toEqual({
      countryFills: null,
      showAntipodes: false,
      sunline: null,
      antipodeRelation: null,
      surnameMapLabels: [],
      surnameDisplayMode: 'local',
    });
  });

  it('turns on the antipode presentation only in Other Side', () => {
    useAppStore.setState({ activeMode: 'antipodes' });
    const { result } = renderHook(() => useGlobePresentation());
    expect(result.current.showAntipodes).toBe(true);
    expect(result.current.sunline).toBeNull();
    expect(result.current.countryFills).toBeNull();
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
      expect(result.current.surnameMapLabels).toHaveLength(198),
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
