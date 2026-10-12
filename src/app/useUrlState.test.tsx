import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../state/appStore';
import { useUrlState } from './useUrlState';

const initialState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState(initialState);
  window.history.replaceState({}, '', '/exhibit');
});

afterEach(() => {
  cleanup();
  useAppStore.setState(initialState);
});

describe('Reshaped Earth browser history', () => {
  it('restores the real place and clears the later ranking selection', () => {
    useAppStore.setState({ activeMode: 'reshaped' });
    renderHook(useUrlState);
    const firstPoint = { latitude: 33.7625, longitude: 108.1792 };
    act(() => {
      useAppStore.getState().selectPoint(firstPoint);
      useAppStore.getState().setReshapedSelectedUnitId('ne-156');
    });
    const firstUrl = window.location.href;
    act(() => {
      useAppStore
        .getState()
        .selectPoint({ latitude: -33.8688, longitude: 151.2093 });
      useAppStore.getState().setReshapedSelectedUnitId('ne-036');
    });

    act(() => {
      window.history.replaceState({}, '', firstUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(useAppStore.getState().point).toEqual({
      latitude: expect.closeTo(firstPoint.latitude, 10),
      longitude: expect.closeTo(firstPoint.longitude, 10),
    });
    expect(useAppStore.getState().reshapedSelectedUnitId).toBeUndefined();
  });

  it('ignores a legacy level while restoring the metric and clearing ranking selection', () => {
    useAppStore.setState({
      activeMode: 'reshaped',
      reshapedMetric: 'population',
      reshapedSelectedUnitId: 'ne-156',
    });
    renderHook(useUrlState);

    act(() => {
      window.history.replaceState(
        {},
        '',
        '/exhibit?v=2&mode=reshaped&metric=gdp&level=admin1&point=30.9875%2C113.2208',
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(useAppStore.getState()).toMatchObject({
      activeMode: 'reshaped',
      reshapedMetric: 'gdp',
      point: {
        latitude: expect.closeTo(30.9875, 10),
        longitude: expect.closeTo(113.2208, 10),
      },
    });
    expect(useAppStore.getState().reshapedSelectedUnitId).toBeUndefined();
    expect(useAppStore.getState()).not.toHaveProperty('reshapedLevel');
  });
});
