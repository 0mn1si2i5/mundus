import { useEffect, useSyncExternalStore } from 'react';
import {
  createResourceStore,
  type ResourceLoadState,
} from '../../state/resourceStore';
import type { CircleDataset } from './circleData';

export type CircleLoadState = ResourceLoadState<CircleDataset>;

// The loader chunk, its manifest and the grid URL are fetched only when the
// observation is entered; the lobby never requests them.
const store = createResourceStore<CircleDataset>((signal) =>
  import('./circleData').then(({ loadCircleDataset }) =>
    loadCircleDataset(signal),
  ),
);

export function resetCircleDatasetStore(): void {
  store.reset();
}

export function useCircleDataset(enabled: boolean): CircleLoadState {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    store.register();
    return () => store.unregister();
  }, [enabled]);
  if (!enabled) return { status: 'idle', data: null };
  return snapshot;
}
