import { z } from 'zod';
import {
  normalizeLongitude,
  type GeoPoint,
} from '../features/antipodes/geography';
import { type ModeId } from '../features/modes/modeRegistry';
import type { DevelopmentIndicator } from '../features/development/developmentData';
import {
  clampSunlineTime,
  formatSunlineTime,
  parseSunlineTime,
} from '../features/sunline/solar';

export const DEFAULT_POINT: GeoPoint = {
  latitude: 31.2304,
  longitude: 121.4737,
};

/**
 * The V1 fallback mode. A legacy or unversioned URL that carries mode state
 * resolves to Other Side; this constant is not the V2 lobby default.
 */
export const DEFAULT_MODE: ModeId = 'antipodes';
export const DEFAULT_DEVELOPMENT_INDICATOR: DevelopmentIndicator = 'hdi';
export const DEFAULT_DEVELOPMENT_YEAR = 2023;
export type SurnameDisplayMode = 'local' | 'latin' | 'chinese';
export const DEFAULT_SURNAME_DISPLAY_MODE: SurnameDisplayMode = 'local';
export type SunlineClockMode = 'live' | 'fixed';

export interface ShareableState {
  /** `null` represents the neutral exhibit lobby. */
  activeMode: ModeId | null;
  point: GeoPoint;
  developmentIndicator: DevelopmentIndicator;
  developmentYear: number;
  sunlineTimeMs: number;
  sunlineClockMode: SunlineClockMode;
  surnameDisplayMode: SurnameDisplayMode;
}

export type NavigationNotice = 'unknown-mode';

const modeSchema = z.enum(['antipodes', 'development', 'sunline', 'surnames']);
const developmentIndicatorSchema = z.enum([
  'hdi',
  'health',
  'education',
  'income',
]);
const developmentYearSchema = z.coerce.number().int().min(1990).max(2023);
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
  if (isV2) {
    activeMode = mode.success ? mode.data : null;
  } else if (isV1 || hasLegacyState) {
    activeMode = mode.success ? mode.data : DEFAULT_MODE;
  } else {
    activeMode = null;
  }

  const coordinate = coordinateSchema.safeParse(params.get('point'));
  const developmentIndicator = developmentIndicatorSchema.safeParse(
    params.get('indicator'),
  );
  const developmentYear = developmentYearSchema.safeParse(params.get('year'));
  const parsedSunlineTime = params.get('time');
  const surnameDisplayMode = surnameDisplayModeSchema.safeParse(
    params.get('surname'),
  );
  const sunlineTimeMs =
    activeMode === 'sunline' && parsedSunlineTime
      ? parseSunlineTime(parsedSunlineTime)
      : null;

  return {
    activeMode,
    point: coordinate.success
      ? {
          latitude: coordinate.data[0],
          longitude: normalizeLongitude(coordinate.data[1]),
        }
      : DEFAULT_POINT,
    developmentIndicator: developmentIndicator.success
      ? developmentIndicator.data
      : DEFAULT_DEVELOPMENT_INDICATOR,
    developmentYear: developmentYear.success
      ? developmentYear.data
      : DEFAULT_DEVELOPMENT_YEAR,
    sunlineTimeMs: sunlineTimeMs ?? clampSunlineTime(nowMs),
    sunlineClockMode: sunlineTimeMs === null ? 'live' : 'fixed',
    surnameDisplayMode: surnameDisplayMode.success
      ? surnameDisplayMode.data
      : DEFAULT_SURNAME_DISPLAY_MODE,
  };
}

export function parseNavigationNotice(search: string): NavigationNotice | null {
  const params = new URLSearchParams(search);
  if (params.get('v') !== '2') return null;
  const modeRaw = params.get('mode');
  if (modeRaw === null) return null;
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
    if (state.activeMode === 'development') {
      if (state.developmentIndicator !== DEFAULT_DEVELOPMENT_INDICATOR) {
        params.set('indicator', state.developmentIndicator);
      }
      if (state.developmentYear !== DEFAULT_DEVELOPMENT_YEAR) {
        params.set('year', String(state.developmentYear));
      }
    }
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
