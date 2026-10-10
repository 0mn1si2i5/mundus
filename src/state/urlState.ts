import { z } from 'zod';
import {
  normalizeLongitude,
  type GeoPoint,
} from '../features/antipodes/geography';
import { type ModeId } from '../features/modes/modeRegistry';
import {
  clampSunlineTime,
  formatSunlineTime,
  parseSunlineTime,
} from '../features/sunline/solar';
import {
  ALPHA_DEFAULT,
  parseAlphaParam,
} from '../features/isolation/isolationMetric';
import {
  RESHAPED_DEFAULT_LEVEL,
  RESHAPED_DEFAULT_METRIC,
  isReshapedLevel,
  isReshapedMetric,
  type ReshapedLevelId,
  type ReshapedMetricId,
} from '../features/reshaped/metrics';

export const DEFAULT_POINT: GeoPoint = {
  latitude: 31.2304,
  longitude: 121.4737,
};

/**
 * The V1 fallback mode. A legacy or unversioned URL that carries mode state
 * resolves to Other Side; this constant is not the V2 lobby default.
 */
export const DEFAULT_MODE: ModeId = 'antipodes';
export type SurnameDisplayMode = 'local' | 'latin' | 'chinese';
export const DEFAULT_SURNAME_DISPLAY_MODE: SurnameDisplayMode = 'local';
export type IsolationView = 'city' | 'field';
export const DEFAULT_ISOLATION_VIEW: IsolationView = 'city';
export type SunlineClockMode = 'live' | 'fixed';

export interface ShareableState {
  /** `null` represents the neutral exhibit lobby. */
  activeMode: ModeId | null;
  point: GeoPoint;
  sunlineTimeMs: number;
  sunlineClockMode: SunlineClockMode;
  surnameDisplayMode: SurnameDisplayMode;
  isolationAlpha: number;
  isolationView: IsolationView;
  reshapedMetric?: ReshapedMetricId;
  reshapedLevel?: ReshapedLevelId;
}

export type NavigationNotice = 'unknown-mode' | 'retired-mode';

const modeSchema = z.enum([
  'antipodes',
  'sunline',
  'surnames',
  'isolation',
  'reshaped',
]);
/** Observations that once shipped; their links open the lobby with a notice. */
const RETIRED_MODES: ReadonlySet<string> = new Set(['development']);
const surnameDisplayModeSchema = z.enum(['local', 'latin', 'chinese']);
const coordinateSchema = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/)
  .transform((value) => value.split(',').map(Number) as [number, number])
  .refine(
    ([latitude, longitude]) =>
      Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180,
  );

const LEGACY_STATE_KEYS = [
  'mode',
  'point',
  'indicator',
  'year',
  'time',
] as const;

export function parseUrlState(
  search: string,
  nowMs = Date.now(),
): ShareableState {
  const params = new URLSearchParams(search);
  const version = params.get('v');
  const isV2 = version === '2';
  const isV1 = version === '1';
  const modeRaw = params.get('mode');
  const mode = modeSchema.safeParse(modeRaw);
  const hasLegacyState = LEGACY_STATE_KEYS.some((key) => params.has(key));

  let activeMode: ModeId | null;
  if (modeRaw !== null && RETIRED_MODES.has(modeRaw)) {
    activeMode = null;
  } else if (isV2) {
    activeMode = mode.success ? mode.data : null;
  } else if (isV1 || hasLegacyState) {
    activeMode = mode.success ? mode.data : DEFAULT_MODE;
  } else {
    activeMode = null;
  }

  const coordinate = coordinateSchema.safeParse(params.get('point'));
  const parsedSunlineTime = params.get('time');
  const surnameDisplayMode = surnameDisplayModeSchema.safeParse(
    params.get('surname'),
  );
  const sunlineTimeMs =
    activeMode === 'sunline' && parsedSunlineTime
      ? parseSunlineTime(parsedSunlineTime)
      : null;
  const isolationAlpha =
    activeMode === 'isolation'
      ? parseAlphaParam(params.get('alpha'))
      : ALPHA_DEFAULT;
  const isolationView =
    activeMode === 'isolation' && params.get('view') === 'field'
      ? 'field'
      : DEFAULT_ISOLATION_VIEW;
  const rawReshapedMetric = params.get('metric');
  const rawReshapedLevel = params.get('level');
  const reshapedMetric =
    activeMode === 'reshaped' && isReshapedMetric(rawReshapedMetric)
      ? rawReshapedMetric
      : RESHAPED_DEFAULT_METRIC;
  const reshapedLevel =
    activeMode === 'reshaped' && isReshapedLevel(rawReshapedLevel)
      ? rawReshapedLevel
      : RESHAPED_DEFAULT_LEVEL;

  return {
    activeMode,
    point: coordinate.success
      ? {
          latitude: coordinate.data[0],
          longitude: normalizeLongitude(coordinate.data[1]),
        }
      : DEFAULT_POINT,
    sunlineTimeMs: sunlineTimeMs ?? clampSunlineTime(nowMs),
    sunlineClockMode: sunlineTimeMs === null ? 'live' : 'fixed',
    surnameDisplayMode: surnameDisplayMode.success
      ? surnameDisplayMode.data
      : DEFAULT_SURNAME_DISPLAY_MODE,
    isolationAlpha,
    isolationView,
    ...(activeMode === 'reshaped' ? { reshapedMetric, reshapedLevel } : {}),
  };
}

export function parseNavigationNotice(search: string): NavigationNotice | null {
  const params = new URLSearchParams(search);
  const modeRaw = params.get('mode');
  if (modeRaw === null) return null;
  if (RETIRED_MODES.has(modeRaw)) return 'retired-mode';
  if (params.get('v') !== '2') return null;
  if (modeSchema.safeParse(modeRaw).success) return null;
  return 'unknown-mode';
}

export function serializeUrlState(state: ShareableState): string {
  const params = new URLSearchParams();
  const hasPoint =
    state.point.latitude !== DEFAULT_POINT.latitude ||
    state.point.longitude !== DEFAULT_POINT.longitude;

  if (state.activeMode === null) {
    if (hasPoint) {
      params.set('point', formatPoint(state.point));
      params.set('v', '2');
    }
  } else {
    params.set('mode', state.activeMode);
    if (hasPoint) params.set('point', formatPoint(state.point));
    if (state.activeMode === 'sunline' && state.sunlineClockMode === 'fixed') {
      params.set('time', formatSunlineTime(state.sunlineTimeMs));
    }
    if (
      state.activeMode === 'surnames' &&
      (state.surnameDisplayMode ?? DEFAULT_SURNAME_DISPLAY_MODE) !==
        DEFAULT_SURNAME_DISPLAY_MODE
    ) {
      params.set(
        'surname',
        state.surnameDisplayMode ?? DEFAULT_SURNAME_DISPLAY_MODE,
      );
    }
    if (
      state.activeMode === 'isolation' &&
      state.isolationAlpha !== ALPHA_DEFAULT
    ) {
      params.set('alpha', state.isolationAlpha.toFixed(2));
    }
    if (
      state.activeMode === 'isolation' &&
      state.isolationView !== DEFAULT_ISOLATION_VIEW
    ) {
      params.set('view', state.isolationView);
    }
    if (state.activeMode === 'reshaped') {
      if (
        (state.reshapedMetric ?? RESHAPED_DEFAULT_METRIC) !==
        RESHAPED_DEFAULT_METRIC
      ) {
        params.set('metric', state.reshapedMetric ?? RESHAPED_DEFAULT_METRIC);
      }
      if (
        (state.reshapedLevel ?? RESHAPED_DEFAULT_LEVEL) !==
        RESHAPED_DEFAULT_LEVEL
      ) {
        params.set('level', state.reshapedLevel ?? RESHAPED_DEFAULT_LEVEL);
      }
    }
    params.set('v', '2');
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

function formatPoint(point: GeoPoint): string {
  return `${formatCoordinate(point.latitude)},${formatCoordinate(point.longitude)}`;
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(4)).toString();
}
