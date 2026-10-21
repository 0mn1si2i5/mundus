import { useEffect, useSyncExternalStore } from 'react';
import {
  createResourceStore,
  type ResourceLoadState,
} from '../../state/resourceStore';
import { loadLiteralNames, type LiteralNameDataset } from './literalNameData';

export type LiteralNamesLoadState = ResourceLoadState<LiteralNameDataset>;

const store = createResourceStore<LiteralNameDataset>(() => loadLiteralNames());

export function resetLiteralNamesStore(): void {
  store.reset();
}

export function useLiteralNames(enabled: boolean): LiteralNamesLoadState {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    store.register();
    return () => store.unregister();
  }, [enabled]);

  if (!enabled) return { status: 'idle', data: null };
  return snapshot;
}
