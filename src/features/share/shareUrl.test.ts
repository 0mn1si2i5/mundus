import { describe, expect, it } from 'vitest';
import { createShareUrl } from './shareUrl';

describe('createShareUrl', () => {
  const nowMs = Date.parse('2026-07-14T09:37:00Z');
  const base = {
    point: { latitude: 31.2304, longitude: 121.4737 },
    sunlineTimeMs: nowMs,
    sunlineClockMode: 'live' as const,
    surnameDisplayMode: 'local' as const,
    isolationAlpha: 0.5,
    isolationView: 'city' as const,
  };

  it('serializes a default lobby to a bare URL', () => {
    expect(
      createShareUrl('https://example.com/path?old=1#section', {
        ...base,
        activeMode: null,
      }),
    ).toBe('https://example.com/path');
  });

  it('serializes a lobby point canonically to at most four decimals', () => {
    expect(
      createShareUrl('https://example.com/path', {
        ...base,
        activeMode: null,
        point: { latitude: 30.12346, longitude: 120.98765 },
      }),
    ).toBe('https://example.com/path?point=30.1235%2C120.9877&v=2');
  });

  it('serializes an active mode with an explicit mode id', () => {
    expect(
      createShareUrl('https://example.com/path', {
        ...base,
        activeMode: 'antipodes',
        point: { latitude: 30.12346, longitude: 120.98765 },
      }),
    ).toBe(
      'https://example.com/path?mode=antipodes&point=30.1235%2C120.9877&v=2',
    );
  });

  it('materializes live Sunline time into a reproducible share URL', () => {
    const url = createShareUrl('https://example.com/path?mode=sunline', {
      ...base,
      activeMode: 'sunline',
    });
    expect(url).toContain('time=2026-07-14T09%3A37Z');
  });
});
