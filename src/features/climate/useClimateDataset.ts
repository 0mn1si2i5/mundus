import { useEffect, useSyncExternalStore } from 'react';
import {
  createResourceStore,
  type ResourceLoadState,
} from '../../state/resourceStore';
import type { ClimateDataset } from './climateMetrics';

export type ClimateLoadState = ResourceLoadState<ClimateDataset>;

const store = createResourceStore<ClimateDataset>((signal) =>
  import('./climateData').then(({ loadClimateDataset }) =>
    loadClimateDataset(signal),
  ),
);

export function resetClimateDatasetStore(): void {
  store.reset();
}

/** One shared class-raster load for the globe layer and the result card. */
export function useClimateDataset(enabled: boolean): ClimateLoadState {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    store.register();
    return () => store.unregister();
  }, [enabled]);

  if (!enabled) return { status: 'idle', data: null };
  return snapshot;
}
