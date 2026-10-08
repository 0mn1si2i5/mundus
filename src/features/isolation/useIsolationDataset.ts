import { useEffect, useSyncExternalStore } from 'react';
import { createResourceStore } from '../../state/resourceStore';
import { loadIsolationDataset, type IsolationDataset } from './isolationData';

export type IsolationLoadState =
  | { status: 'idle'; data: null }
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: IsolationDataset }
  | { status: 'error'; data: null; retry: () => void };

const store = createResourceStore<IsolationDataset>(() =>
  loadIsolationDataset(),
);

export function resetIsolationDatasetStore(): void {
  store.reset();
}

export function useIsolationDataset(enabled: boolean): IsolationLoadState {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    store.register();
    return () => store.unregister();
  }, [enabled]);
  if (!enabled) return { status: 'idle', data: null };
  return snapshot;
}
