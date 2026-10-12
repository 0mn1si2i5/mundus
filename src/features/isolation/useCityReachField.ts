import { useEffect, useSyncExternalStore } from 'react';
import { loadCityReachFrame, loadCityReachMetadata } from './cityReachData';
import type { CityReachFrame, CityReachMetadata } from './cityReachTypes';
import { CITY_REACH_DEFAULT, type CityReachLevel } from './cityReachLevel';

export interface CityReachFieldState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  metadata: CityReachMetadata | null;
  /** Only a GPU-confirmed frame is shown to card/lookup consumers. */
  frame: CityReachFrame | null;
  pendingFrame: CityReachFrame | null;
  requestedLevel: CityReachLevel;
  quality: 'low';
  error: unknown;
  retry(): void;
  commitFrame(frame: CityReachFrame): void;
  rejectFrame(frame: CityReachFrame, error: unknown): void;
}

type Snapshot = Omit<
  CityReachFieldState,
  'retry' | 'commitFrame' | 'rejectFrame'
>;
const idle = (): Snapshot => ({
  status: 'idle',
  metadata: null,
  frame: null,
  pendingFrame: null,
  requestedLevel: CITY_REACH_DEFAULT,
  quality: 'low',
  error: null,
});
let state = idle();
let consumers = 0;
let controller: AbortController | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;
function update(next: Snapshot) {
  state = next;
  for (const listener of listeners) listener();
}

function request(level: CityReachLevel, retry = false) {
  if (!consumers) return;
  if (!retry && state.requestedLevel === level && state.status !== 'idle')
    return;
  controller?.abort();
  if (!retry && state.frame?.level === level) {
    controller = null;
    update({
      ...state,
      requestedLevel: level,
      status: 'ready',
      pendingFrame: null,
      error: null,
    });
    return;
  }
  const current = new AbortController();
  controller = current;
  update({
    ...state,
    status: 'loading',
    requestedLevel: level,
    pendingFrame: null,
    error: null,
  });
  const existingMetadata = state.metadata;
  void (async () => {
    const metadata =
      existingMetadata ?? (await loadCityReachMetadata(current.signal));
    if (controller !== current || current.signal.aborted) return;
    update({ ...state, metadata });
    const frame = await loadCityReachFrame(
      metadata,
      level,
      'low',
      current.signal,
      state.frame?.density,
    );
    if (controller !== current || current.signal.aborted) return;
    controller = null;
    update({ ...state, status: 'loading', pendingFrame: frame });
  })().catch((error: unknown) => {
    if (controller !== current || current.signal.aborted) return;
    controller = null;
    update({ ...state, status: 'error', pendingFrame: null, error });
  });
}

function retry() {
  request(state.requestedLevel, true);
}
function commitFrame(frame: CityReachFrame) {
  if (!consumers || state.pendingFrame !== frame) return;
  update({ ...state, frame, pendingFrame: null, status: 'ready', error: null });
}
function rejectFrame(frame: CityReachFrame, error: unknown) {
  if (!consumers || (state.pendingFrame !== frame && state.frame !== frame))
    return;
  const activeFailed = state.frame === frame;
  if (activeFailed) {
    controller?.abort();
    controller = null;
  }
  update({
    ...state,
    frame: activeFailed ? null : state.frame,
    pendingFrame: null,
    status: 'error',
    error,
  });
}

/** Clears all typed arrays on last exit; pending results cannot repopulate them. */
export function resetCityReachFieldStore() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  controller?.abort();
  controller = null;
  update(idle());
}

function register() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  consumers += 1;
}
function unregister() {
  consumers = Math.max(0, consumers - 1);
  if (!consumers)
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      if (!consumers) resetCityReachFieldStore();
    }, 0);
}

const actions = { retry, commitFrame, rejectFrame };
export function useCityReachField(
  level: CityReachLevel,
  enabled: boolean,
): CityReachFieldState {
  const shared = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!enabled) return;
    register();
    return unregister;
  }, [enabled]);
  useEffect(() => {
    if (enabled) request(level);
  }, [level, enabled]);
  return { ...(enabled ? shared : idle()), ...actions };
}
