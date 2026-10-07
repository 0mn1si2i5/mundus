import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVELOPMENT_INDICATOR,
  DEFAULT_DEVELOPMENT_YEAR,
  DEFAULT_POINT,
  DEFAULT_SURNAME_DISPLAY_MODE,
  parseNavigationNotice,
  parseUrlState,
  serializeUrlState,
  type ShareableState,
} from './urlState';

describe('URL state codec', () => {
  const nowMs = Date.parse('2026-07-14T09:37:00Z');
  const sunlineDefaults = {
    sunlineTimeMs: nowMs,
    sunlineClockMode: 'live' as const,
  };

  const lobby: ShareableState = {
    activeMode: null,
    point: DEFAULT_POINT,
    developmentIndicator: DEFAULT_DEVELOPMENT_INDICATOR,
    developmentYear: DEFAULT_DEVELOPMENT_YEAR,
    ...sunlineDefaults,
    surnameDisplayMode: DEFAULT_SURNAME_DISPLAY_MODE,
  };

  describe('parseUrlState', () => {
    it('opens the lobby for a bare address', () => {
      expect(parseUrlState('', nowMs)).toEqual(lobby);
    });

    it('stays in the lobby for non-share parameters', () => {
      expect(parseUrlState('?benchmark=1&dragDiagnostics=2', nowMs)).toEqual(
        lobby,
      );
    });

    it('preserves legacy Other Side semantics for an unversioned historical URL', () => {
      expect(parseUrlState('?point=12.3457%2C-98.7654', nowMs)).toMatchObject({
        activeMode: 'antipodes',
        point: { latitude: 12.3457, longitude: -98.7654 },
      });
    });

    it('preserves V1 semantics including the default mode', () => {
      expect(parseUrlState('?v=1', nowMs)).toMatchObject({
        activeMode: 'antipodes',
      });
      expect(parseUrlState('?v=1&mode=development', nowMs)).toMatchObject({
        activeMode: 'development',
      });
    });

    it('opens the lobby for v=2 without a mode', () => {
      expect(parseUrlState('?v=2', nowMs)).toEqual(lobby);
      expect(
        parseUrlState('?v=2&point=12.3457%2C-98.7654', nowMs),
      ).toMatchObject({
        activeMode: null,
        point: { latitude: 12.3457, longitude: -98.7654 },
      });
    });

    it('opens the requested mode for a valid v=2 mode', () => {
      expect(parseUrlState('?v=2&mode=sunline', nowMs)).toMatchObject({
        activeMode: 'sunline',
      });
      expect(parseUrlState('?v=2&mode=surnames', nowMs)).toMatchObject({
        activeMode: 'surnames',
      });
    });

    it('falls back to the lobby for an unknown v=2 mode', () => {
      expect(parseUrlState('?v=2&mode=bogus', nowMs)).toMatchObject({
        activeMode: null,
      });
    });

    it('surfaces a navigation notice only for an unknown v=2 mode', () => {
      expect(parseNavigationNotice('?v=2&mode=bogus')).toBe('unknown-mode');
      expect(parseNavigationNotice('?v=2&mode=sunline')).toBeNull();
      expect(parseNavigationNotice('?v=2')).toBeNull();
      expect(parseNavigationNotice('?v=1&mode=bogus')).toBeNull();
    });

    it('keeps the legacy safe fallback for invalid V1 input', () => {
      expect(parseUrlState('?mode=nope&point=91,0', nowMs)).toMatchObject({
        activeMode: 'antipodes',
        point: DEFAULT_POINT,
      });
    });

    it('still parses coordinates, development, and Sunline state in V2', () => {
      expect(
        parseUrlState(
          '?v=2&mode=development&indicator=education&year=2005&point=12.3457%2C-98.7654',
          nowMs,
        ),
      ).toMatchObject({
        activeMode: 'development',
        point: { latitude: 12.3457, longitude: -98.7654 },
        developmentIndicator: 'education',
        developmentYear: 2005,
      });
    });
  });

  describe('serializeUrlState', () => {
    it('serializes the default lobby to an empty query', () => {
      expect(serializeUrlState(lobby)).toBe('');
    });

    it('serializes a lobby with a non-default point as a V2 point link', () => {
      expect(
        serializeUrlState({
          ...lobby,
          point: { latitude: 12.345678, longitude: -98.765432 },
        }),
      ).toBe('?point=12.3457%2C-98.7654&v=2');
    });

    it('always serializes an active mode explicitly, including Other Side', () => {
      expect(serializeUrlState({ ...lobby, activeMode: 'antipodes' })).toBe(
        '?mode=antipodes&v=2',
      );
    });

    it('serializes mode and coordinates with bounded precision', () => {
      expect(
        serializeUrlState({
          ...lobby,
          activeMode: 'sunline',
          point: { latitude: 12.345678, longitude: -98.765432 },
        }),
      ).toBe('?mode=sunline&point=12.3457%2C-98.7654&v=2');
    });

    it('serializes non-default development state only in that mode', () => {
      expect(
        serializeUrlState({
          ...lobby,
          activeMode: 'development',
          developmentIndicator: 'education',
          developmentYear: 2005,
        }),
      ).toBe('?mode=development&indicator=education&year=2005&v=2');
    });

    it('serializes fixed Sunline time in V2', () => {
      expect(
        serializeUrlState({
          ...lobby,
          activeMode: 'sunline',
          sunlineTimeMs: nowMs,
          sunlineClockMode: 'fixed',
        }),
      ).toBe('?mode=sunline&time=2026-07-14T09%3A37Z&v=2');
    });

    it('serializes non-default surname display mode and omits the local default', () => {
      expect(
        serializeUrlState({
          ...lobby,
          activeMode: 'surnames',
          surnameDisplayMode: 'latin',
        }),
      ).toBe('?mode=surnames&surname=latin&v=2');
      expect(
        serializeUrlState({
          ...lobby,
          activeMode: 'surnames',
          surnameDisplayMode: 'local',
        }),
      ).toBe('?mode=surnames&v=2');
    });

    it('upgrades a legacy V1 state to an equivalent V2 link', () => {
      const legacy = parseUrlState(
        '?mode=sunline&point=35.6762%2C139.6503&v=1',
        nowMs,
      );
      expect(serializeUrlState(legacy)).toBe(
        '?mode=sunline&point=35.6762%2C139.6503&v=2',
      );
    });
  });

  describe('round trips', () => {
    it('round-trips an active state through V2', () => {
      const link = serializeUrlState({
        ...lobby,
        activeMode: 'sunline',
        point: { latitude: 12.345678, longitude: -98.765432 },
      });
      expect(parseUrlState(link, nowMs)).toEqual({
        activeMode: 'sunline',
        point: { latitude: 12.3457, longitude: -98.7654 },
        developmentIndicator: DEFAULT_DEVELOPMENT_INDICATOR,
        developmentYear: DEFAULT_DEVELOPMENT_YEAR,
        ...sunlineDefaults,
        surnameDisplayMode: 'local',
      });
    });

    it('round-trips a lobby point link back to the lobby', () => {
      const link = serializeUrlState({
        ...lobby,
        point: { latitude: 12.3457, longitude: -98.7654 },
      });
      expect(parseUrlState(link, nowMs)).toMatchObject({
        activeMode: null,
        point: { latitude: 12.3457, longitude: -98.7654 },
      });
    });
  });
});
