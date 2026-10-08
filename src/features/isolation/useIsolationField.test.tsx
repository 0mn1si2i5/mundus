import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import asset from '../../data/generated/urban-isolation.json';
import { decodeIsolationDataset } from './isolationData';
import { useIsolationField } from './useIsolationField';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    MockWorker.instances.push(this);
  }
}
const dataset = decodeIsolationDataset(asset);
const table = {
  columns: 1,
  rows: 1,
  tiles: new Float32Array(4),
  candidates: new Float32Array(4),
  maxCandidates: 1,
};

describe('global field resource', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads only when enabled, shares one worker, cancels stale work, and releases on exit', () => {
    const first = renderHook(
      ({ alpha, enabled }) => useIsolationField(dataset, alpha, enabled),
      { initialProps: { alpha: 0.5, enabled: false } },
    );
    expect(MockWorker.instances).toHaveLength(0);
    first.rerender({ alpha: 0.5, enabled: true });
    const second = renderHook(
      ({ alpha }) => useIsolationField(dataset, alpha, true),
      { initialProps: { alpha: 0.5 } },
    );
    expect(MockWorker.instances).toHaveLength(1);
    const old = MockWorker.instances[0]!;
    first.rerender({ alpha: 0.7, enabled: true });
    second.rerender({ alpha: 0.7 });
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(MockWorker.instances).toHaveLength(2);
    act(() => {
      old.onerror?.();
      old.onmessage?.({ data: { status: 'ready', table } } as MessageEvent);
    });
    expect(first.result.current.status).toBe('loading');
    const current = MockWorker.instances[1]!;
    act(() =>
      current.onmessage?.({ data: { status: 'ready', table } } as MessageEvent),
    );
    expect(second.result.current.status).toBe('ready');
    expect(first.result.current.table).toBe(table);
    expect(current.terminate).toHaveBeenCalledOnce();
    first.unmount();
    expect(second.result.current.status).toBe('ready');
    second.unmount();
    const reentry = renderHook(() => useIsolationField(dataset, 0.7, true));
    expect(reentry.result.current.status).toBe('loading');
    expect(MockWorker.instances).toHaveLength(3);
    reentry.unmount();
    expect(MockWorker.instances[2]!.terminate).toHaveBeenCalledOnce();
  });

  it('exposes failure and retries a fresh worker', () => {
    const hook = renderHook(() => useIsolationField(dataset, 0.5, true));
    act(() => MockWorker.instances[0]!.onerror?.());
    expect(hook.result.current.status).toBe('error');
    act(() => hook.result.current.retry());
    expect(hook.result.current.status).toBe('loading');
    expect(MockWorker.instances).toHaveLength(2);
    hook.unmount();
  });
});
