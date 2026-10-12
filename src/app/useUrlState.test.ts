import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../state/appStore';
import { DEFAULT_POINT, parseUrlState } from '../state/urlState';
import { useUrlState } from './useUrlState';

describe('field reach history', () => {
  beforeEach(() => {
    window.history.replaceState(
      null,
      '',
      '/?v=2&mode=isolation&alpha=0.37&view=field',
    );
    useAppStore.setState(parseUrlState(window.location.search));
  });
  afterEach(() => vi.restoreAllMocks());

  it('replaces reach changes, pushes point/view changes, and restores alpha and reach on popstate', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const push = vi.spyOn(window.history, 'pushState');
    const hook = renderHook(() => useUrlState());
    act(() => useAppStore.getState().setIsolationReach(8));
    expect(replace).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get('reach')).toBe('8');
    expect(new URLSearchParams(window.location.search).get('alpha')).toBe(
      '0.37',
    );

    act(() =>
      useAppStore.getState().selectPoint({ latitude: 1.35, longitude: 103.84 }),
    );
    act(() => useAppStore.getState().setIsolationView('city'));
    expect(push).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams(window.location.search).get('reach')).toBeNull();
    expect(useAppStore.getState().isolationReach).toBe(8);

    window.history.replaceState(
      null,
      '',
      '/?v=2&mode=isolation&alpha=0.62&view=field&reach=2',
    );
    push.mockClear();
    replace.mockClear();
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(useAppStore.getState()).toMatchObject({
      isolationAlpha: 0.62,
      isolationReach: 2,
      isolationView: 'field',
      point: DEFAULT_POINT,
    });
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    hook.unmount();
  });
});
