import { useEffect, useSyncExternalStore } from 'react';
import {
  createResourceStore,
  type ResourceLoadState,
} from '../../state/resourceStore';
import { loadLandBorderGraph, type LandBorderGraph } from './landBorders';

export type LandBordersLoadState = ResourceLoadState<LandBorderGraph>;

const store = createResourceStore<LandBorderGraph>(() => loadLandBorderGraph());

export function resetLandBordersStore(): void {
  store.reset();
}

export function useLandBorders(enabled: boolean): LandBordersLoadState {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    store.register();
    return () => store.unregister();
  }, [enabled]);

  if (!enabled) return { status: 'idle', data: null };
  return snapshot;
}
