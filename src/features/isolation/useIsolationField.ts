import { useEffect } from 'react';
import { create } from 'zustand';
import type { IsolationDataset } from './isolationData';
import {
  createIsolationFieldSites,
  type IsolationFieldSite,
  type IsolationFieldTable,
} from './isolationField';

export type IsolationFieldState = {
  status: 'idle' | 'loading' | 'error' | 'ready';
  alpha: number;
  sites: readonly IsolationFieldSite[];
  table: IsolationFieldTable | null;
};
const idle: IsolationFieldState = {
  status: 'idle',
  alpha: 0,
  sites: [],
  table: null,
};
const useFieldStore = create<IsolationFieldState>(() => idle);
let worker: Worker | null = null;
let users = 0;
let currentDataset: IsolationDataset | null = null;

function request(dataset: IsolationDataset, alpha: number, retry = false) {
  const current = useFieldStore.getState();
  if (
    !retry &&
    dataset === currentDataset &&
    current.alpha === alpha &&
    current.status !== 'idle'
  )
    return;
  worker?.terminate();
  worker = null;
  currentDataset = dataset;
  const sites = createIsolationFieldSites(dataset, alpha);
  useFieldStore.setState({ status: 'loading', alpha, sites, table: null });
  const failed = () => {
    worker?.terminate();
    worker = null;
    useFieldStore.setState({ status: 'error', table: null });
  };
  try {
    const next = new Worker(
      new URL('./isolationField.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker = next;
    next.onmessage = (
      event: MessageEvent<
        | { status: 'ready'; table: IsolationFieldTable }
        | { status: 'error'; message: string }
      >,
    ) => {
      if (worker !== next) return;
      if (event.data.status === 'error') {
        failed();
        return;
      }
      useFieldStore.setState({ status: 'ready', table: event.data.table });
      next.terminate();
      worker = null;
    };
    next.onerror = () => {
      if (worker === next) failed();
    };
    next.postMessage(sites);
  } catch {
    failed();
  }
}

/** One worker shared by the card and globe; cancelled on alpha changes/exit. */
export function useIsolationField(
  dataset: IsolationDataset | null,
  alpha: number,
  enabled: boolean,
) {
  const state = useFieldStore();
  useEffect(() => {
    if (!enabled || !dataset) return;
    users += 1;
    return () => {
      users -= 1;
      if (users === 0) {
        worker?.terminate();
        worker = null;
        currentDataset = null;
        useFieldStore.setState(idle);
      }
    };
  }, [dataset, enabled]);
  useEffect(() => {
    if (enabled && dataset) request(dataset, alpha);
  }, [alpha, dataset, enabled]);
  const active =
    enabled && dataset && state.alpha === alpha && currentDataset === dataset;
  return {
    ...(active ? state : idle),
    retry: () => {
      if (enabled && dataset) request(dataset, alpha, true);
    },
  };
}
