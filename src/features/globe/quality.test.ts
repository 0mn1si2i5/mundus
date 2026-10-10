import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseQualityProfile } from './quality';

describe('render quality', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shares the initial quality between the Canvas and assets after a viewport change', async () => {
    vi.resetModules();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    const { getRuntimeQualityProfile } = await import('./quality');
    const initial = getRuntimeQualityProfile();
    expect(initial.level).toBe('low');
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440);
    expect(getRuntimeQualityProfile()).toBe(initial);
  });

  it('uses a bounded low profile on mobile', () => {
    const profile = chooseQualityProfile({
      viewportWidth: 390,
      viewportHeight: 844,
      devicePixelRatio: 3,
      hardwareConcurrency: 6,
    });
    expect(profile.level).toBe('low');
    expect(profile.dpr[1]).toBe(1.25);
    expect(profile.textureWidth).toBe(1024);
    expect(profile.vectorDetail).toBe('110m');
  });

  it('uses the bounded low profile on a landscape Pixel 7-class viewport', () => {
    const profile = chooseQualityProfile({
      viewportWidth: 915,
      viewportHeight: 412,
      devicePixelRatio: 3,
      hardwareConcurrency: 8,
    });
    expect(profile.level).toBe('low');
    expect(profile.dpr).toEqual([1, 1.25]);
    expect(profile.textureWidth).toBe(1024);
    expect(profile.vectorDetail).toBe('110m');
  });

  it('selects the detailed profile only for capable desktops', () => {
    const profile = chooseQualityProfile({
      viewportWidth: 1440,
      viewportHeight: 900,
      devicePixelRatio: 2,
      hardwareConcurrency: 10,
    });
    expect(profile.level).toBe('high');
    expect(profile.textureWidth).toBe(2048);
    expect(profile.vectorDetail).toBe('50m');
  });

  it('uses the detailed texture on medium desktops', () => {
    const profile = chooseQualityProfile({
      viewportWidth: 1024,
      viewportHeight: 768,
      devicePixelRatio: 1,
      hardwareConcurrency: 6,
    });
    expect(profile.level).toBe('medium');
    expect(profile.textureWidth).toBe(2048);
    expect(profile.vectorDetail).toBe('50m');
  });

  it('preserves the detailed profile for a normal 1280 by 720 desktop', () => {
    const profile = chooseQualityProfile({
      viewportWidth: 1280,
      viewportHeight: 720,
      devicePixelRatio: 1,
      hardwareConcurrency: 8,
    });
    expect(profile.level).toBe('high');
    expect(profile.textureWidth).toBe(2048);
    expect(profile.vectorDetail).toBe('50m');
  });

  it.each([
    [480, 'low', '110m'],
    [481, 'high', '50m'],
  ] as const)(
    'applies the phone-class short-edge boundary at %i pixels',
    (viewportHeight, level, vectorDetail) => {
      const profile = chooseQualityProfile({
        viewportWidth: 1280,
        viewportHeight,
        devicePixelRatio: 2,
        hardwareConcurrency: 8,
      });
      expect(profile.level).toBe(level);
      expect(profile.vectorDetail).toBe(vectorDetail);
    },
  );
});
