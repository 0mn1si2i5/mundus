import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCityReachFrame, loadCityReachMetadata } from './cityReachData';
import {
  resetCityReachFieldStore,
  useCityReachField,
} from './useCityReachField';
import type { CityReachLevel } from './cityReachLevel';
import type { CityReachFrame, CityReachMetadata } from './cityReachTypes';

vi.mock('./cityReachData', () => ({
  loadCityReachFrame: vi.fn(),
  loadCityReachMetadata: vi.fn(),
}));

const metadata = {
  manifest: {},
  cities: [],
  byId: new Map(),
  inspectableCities: [],
} as unknown as CityReachMetadata;
function frame(level: CityReachLevel): CityReachFrame {
  return {
    level,
    quality: 'low',
    grid: {
      width: 4,
      height: 4,
      west: 0,
      north: 1,
      step: 1 / 30,
      wrapLongitude: false,
    },
    stride: 4,
    width: 1,
    height: 1,
    tiles: [
      {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        owners: new Uint16Array([1]),
        rgba: new Uint8Array([1, 0, 0, 255]),
      },
    ],
    ownerIds: new Set([1]),
    density: { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flushRelease = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('city reach shared display resource', () => {
  beforeEach(() => {
    resetCityReachFieldStore();
    vi.clearAllMocks();
    vi.mocked(loadCityReachMetadata).mockResolvedValue(metadata);
    vi.mocked(loadCityReachFrame).mockImplementation(async (_metadata, level) =>
      frame(level),
    );
  });
  afterEach(() => {
    cleanup();
    resetCityReachFieldStore();
  });

  it('does no inactive load, shares metadata and pixels, and commits only after GPU confirmation', async () => {
    const first = renderHook(({ enabled }) => useCityReachField(4, enabled), {
      initialProps: { enabled: false },
    });
    expect(loadCityReachMetadata).not.toHaveBeenCalled();
    first.rerender({ enabled: true });
    const second = renderHook(() => useCityReachField(4, true));
    await act(async () => {});
    expect(loadCityReachMetadata).toHaveBeenCalledOnce();
    expect(loadCityReachFrame).toHaveBeenCalledOnce();
    expect(first.result.current.status).toBe('loading');
    expect(first.result.current.frame).toBeNull();
    const staged = first.result.current.pendingFrame!;
    expect(second.result.current.pendingFrame).toBe(staged);
    act(() => second.result.current.commitFrame(staged));
    expect(first.result.current.status).toBe('ready');
    expect(first.result.current.frame).toBe(staged);
    expect(first.result.current.pendingFrame).toBeNull();
    first.unmount();
    await act(flushRelease);
    expect(second.result.current.frame).toBe(staged);
    second.unmount();
    await act(flushRelease);
    const reentry = renderHook(() => useCityReachField(4, true));
    expect(reentry.result.current.frame).toBeNull();
    await act(async () => {});
    expect(loadCityReachMetadata).toHaveBeenCalledTimes(2);
    expect(loadCityReachFrame).toHaveBeenCalledTimes(2);
  });

  it('retains the displayed old level through network and GPU failures, then retries and swaps atomically', async () => {
    const hook = renderHook(({ level }) => useCityReachField(level, true), {
      initialProps: { level: 4 as CityReachLevel },
    });
    await act(async () => {});
    const old = hook.result.current.pendingFrame!;
    act(() => hook.result.current.commitFrame(old));
    vi.mocked(loadCityReachFrame).mockRejectedValueOnce(
      new Error('download failed'),
    );
    hook.rerender({ level: 8 });
    await act(async () => {});
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.frame).toBe(old);
    expect(hook.result.current.requestedLevel).toBe(8);
    act(() => hook.result.current.retry());
    await act(async () => {});
    const rejected = hook.result.current.pendingFrame!;
    act(() =>
      hook.result.current.rejectFrame(rejected, new Error('GPU upload failed')),
    );
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.frame).toBe(old);
    expect(hook.result.current.pendingFrame).toBeNull();
    act(() => hook.result.current.commitFrame(rejected));
    expect(hook.result.current.frame).toBe(old);
    act(() => hook.result.current.retry());
    await act(async () => {});
    const accepted = hook.result.current.pendingFrame!;
    act(() => hook.result.current.commitFrame(accepted));
    expect(hook.result.current.frame).toBe(accepted);
    expect(hook.result.current.frame?.level).toBe(8);
    expect(loadCityReachMetadata).toHaveBeenCalledOnce();
    expect(vi.mocked(loadCityReachFrame).mock.calls[1]![4]).toBe(old.density);
  });

  it('survives StrictMode remount without duplicate metadata or PNG requests', async () => {
    const hook = renderHook(() => useCityReachField(4, true), {
      wrapper: ({ children }: PropsWithChildren) => (
        <StrictMode>{children}</StrictMode>
      ),
    });
    await act(async () => {});
    expect(loadCityReachMetadata).toHaveBeenCalledOnce();
    expect(loadCityReachFrame).toHaveBeenCalledOnce();
    const staged = hook.result.current.pendingFrame!;
    act(() => hook.result.current.commitFrame(staged));
    expect(hook.result.current.status).toBe('ready');
  });

  it('retries an initial metadata failure without inventing a displayed frame', async () => {
    vi.mocked(loadCityReachMetadata).mockRejectedValueOnce(
      new Error('missing manifest'),
    );
    const hook = renderHook(() => useCityReachField(4, true));
    await act(async () => {});
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.metadata).toBeNull();
    expect(hook.result.current.frame).toBeNull();
    expect(loadCityReachFrame).not.toHaveBeenCalled();
    act(() => hook.result.current.retry());
    await act(async () => {});
    expect(loadCityReachMetadata).toHaveBeenCalledTimes(2);
    expect(hook.result.current.pendingFrame?.level).toBe(4);
    expect(hook.result.current.frame).toBeNull();
  });

  it('cancels stale level work and ignores both late completion and stale GPU acknowledgements', async () => {
    const slow = deferred<CityReachFrame>();
    vi.mocked(loadCityReachFrame).mockReturnValueOnce(slow.promise);
    const hook = renderHook(({ level }) => useCityReachField(level, true), {
      initialProps: { level: 4 as CityReachLevel },
    });
    await act(async () => {});
    const firstSignal = vi.mocked(loadCityReachFrame).mock.calls[0]![3]!;
    hook.rerender({ level: 16 });
    await act(async () => {});
    expect(firstSignal.aborted).toBe(true);
    const current = hook.result.current.pendingFrame!;
    const stale = frame(4);
    await act(async () => slow.resolve(stale));
    expect(hook.result.current.pendingFrame).toBe(current);
    act(() => {
      hook.result.current.commitFrame(stale);
      hook.result.current.rejectFrame(stale, 'late failure');
    });
    expect(hook.result.current.pendingFrame).toBe(current);
    act(() => hook.result.current.commitFrame(current));
    expect(hook.result.current.frame?.level).toBe(16);
  });

  it('returns to its retained current level without redownloading and aborts abandoned work', async () => {
    const hook = renderHook(({ level }) => useCityReachField(level, true), {
      initialProps: { level: 4 as CityReachLevel },
    });
    await act(async () => {});
    const current = hook.result.current.pendingFrame!;
    act(() => hook.result.current.commitFrame(current));
    const slow = deferred<CityReachFrame>();
    vi.mocked(loadCityReachFrame).mockReturnValueOnce(slow.promise);
    hook.rerender({ level: 8 });
    await act(async () => {});
    const abandonedSignal = vi.mocked(loadCityReachFrame).mock.calls[1]![3]!;
    hook.rerender({ level: 4 });
    expect(abandonedSignal.aborted).toBe(true);
    expect(hook.result.current.status).toBe('ready');
    expect(hook.result.current.frame).toBe(current);
    expect(loadCityReachFrame).toHaveBeenCalledTimes(2);
    await act(async () => slow.resolve(frame(8)));
    expect(hook.result.current.frame).toBe(current);
  });

  it('last exit cancels pending requests and prevents late results from retaining large arrays', async () => {
    const slow = deferred<CityReachFrame>();
    vi.mocked(loadCityReachFrame).mockReturnValueOnce(slow.promise);
    const hook = renderHook(({ enabled }) => useCityReachField(4, enabled), {
      initialProps: { enabled: true },
    });
    await act(async () => {});
    const signal = vi.mocked(loadCityReachFrame).mock.calls[0]![3]!;
    hook.rerender({ enabled: false });
    await act(flushRelease);
    expect(signal.aborted).toBe(true);
    await act(async () => slow.resolve(frame(4)));
    expect(hook.result.current.frame).toBeNull();
    expect(hook.result.current.pendingFrame).toBeNull();
    hook.rerender({ enabled: true });
    await act(async () => {});
    expect(loadCityReachMetadata).toHaveBeenCalledTimes(2);
    expect(hook.result.current.frame).toBeNull();
  });

  it('clears a failed active GPU frame during context recovery, preserves metadata and retries', async () => {
    const hook = renderHook(() => useCityReachField(4, true));
    await act(async () => {});
    const current = hook.result.current.pendingFrame!;
    act(() => hook.result.current.commitFrame(current));
    act(() =>
      hook.result.current.rejectFrame(
        current,
        new Error('context restore failed'),
      ),
    );
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.frame).toBeNull();
    expect(hook.result.current.metadata).toBe(metadata);
    act(() => hook.result.current.retry());
    await act(async () => {});
    expect(hook.result.current.pendingFrame?.level).toBe(4);
    expect(loadCityReachMetadata).toHaveBeenCalledOnce();
  });
});
