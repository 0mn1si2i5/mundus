import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POINT,
  DEFAULT_SURNAME_DISPLAY_MODE,
  parseNavigationNotice,
  parseUrlState,
  serializeUrlState,
  type ShareableState,
} from './urlState';
import { ALPHA_DEFAULT } from '../features/isolation/isolationMetric';

describe('URL state codec', () => {
  const nowMs = Date.parse('2026-07-14T09:37:00Z');
  const sunlineDefaults = {
    sunlineTimeMs: nowMs,
    sunlineClockMode: 'live' as const,
  };

  const lobby: ShareableState = {
    activeMode: null,
    point: DEFAULT_POINT,
    ...sunlineDefaults,
    surnameDisplayMode: DEFAULT_SURNAME_DISPLAY_MODE,
    isolationAlpha: ALPHA_DEFAULT,
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
      expect(parseUrlState('?v=1&mode=sunline', nowMs)).toMatchObject({
        activeMode: 'sunline',
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
      expect(
        parseUrlState('?v=2&mode=isolation&alpha=0.37', nowMs),
      ).toMatchObject({
        activeMode: 'isolation',
        isolationAlpha: 0.37,
      });
    });

    it('rounds valid isolation alpha values and defaults invalid or out-of-range values', () => {
      expect(
        parseUrlState('?v=2&mode=isolation&alpha=0.374', nowMs),
      ).toMatchObject({ isolationAlpha: 0.37 });
      expect(parseUrlState('?v=2&mode=isolation&alpha=1', nowMs)).toMatchObject(
        { isolationAlpha: 1 },
      );

      for (const raw of ['5', '0.05', '0.099', '-1', 'abc', '']) {
        expect(
          parseUrlState(
            `?v=2&mode=isolation&alpha=${encodeURIComponent(raw)}`,
            nowMs,
          ),
        ).toMatchObject({ isolationAlpha: ALPHA_DEFAULT });
      }
    });

    it('ignores isolation alpha outside the isolation mode', () => {
      expect(
        parseUrlState('?v=2&mode=sunline&alpha=0.37', nowMs),
      ).toMatchObject({
        activeMode: 'sunline',
        isolationAlpha: ALPHA_DEFAULT,
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

    it('opens the lobby with a retirement notice for retired Development links', () => {
      for (const search of [
        '?v=2&mode=development&indicator=education&year=2005&point=12.3457%2C-98.7654',
        '?v=1&mode=development&point=12.3457%2C-98.7654',
        '?mode=development&point=12.3457%2C-98.7654',
      ]) {
        expect(parseUrlState(search, nowMs)).toMatchObject({
          activeMode: null,
          point: { latitude: 12.3457, longitude: -98.7654 },
        });
        expect(parseNavigationNotice(search)).toBe('retired-mode');
      }
    });

    it('keeps the legacy safe fallback for invalid V1 input', () => {
      expect(parseUrlState('?mode=nope&point=91,0', nowMs)).toMatchObject({
        activeMode: 'antipodes',
        point: DEFAULT_POINT,
      });
    });

    it('still parses coordinates and Sunline state in V2', () => {
      expect(
        parseUrlState(
          '?v=2&mode=sunline&time=2024-03-20T12%3A00Z&point=12.3457%2C-98.7654',
          nowMs,
        ),
      ).toMatchObject({
        activeMode: 'sunline',
        point: { latitude: 12.3457, longitude: -98.7654 },
        sunlineTimeMs: Date.parse('2024-03-20T12:00:00Z'),
        sunlineClockMode: 'fixed',
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

    it('serializes isolation alpha only when it differs from the default', () => {
      expect(
        serializeUrlState({
          ...lobby,
          activeMode: 'isolation',
          isolationAlpha: ALPHA_DEFAULT,
        }),
      ).toBe('?mode=isolation&v=2');
      expect(
        serializeUrlState({
          ...lobby,
          activeMode: 'isolation',
          isolationAlpha: 0.37,
        }),
      ).toBe('?mode=isolation&alpha=0.37&v=2');
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
        ...sunlineDefaults,
        surnameDisplayMode: 'local',
        isolationAlpha: ALPHA_DEFAULT,
      });
    });

    it('round-trips an isolation alpha through V2', () => {
      const link = serializeUrlState({
        ...lobby,
        activeMode: 'isolation',
        isolationAlpha: 0.37,
      });
      expect(link).toBe('?mode=isolation&alpha=0.37&v=2');
      expect(parseUrlState(link, nowMs)).toEqual({
        ...lobby,
        activeMode: 'isolation',
        isolationAlpha: 0.37,
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
