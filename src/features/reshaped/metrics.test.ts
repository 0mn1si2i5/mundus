import { describe, expect, it } from 'vitest';
import {
  areaRatioBand,
  formatReshapedAreaRatio,
  formatReshapedShare,
  formatReshapedValue,
  isReshapedMetric,
  RESHAPED_METRICS,
  RESHAPED_METRIC_IDS,
} from './metrics';
import {
  contrastRatio,
  applyLinearLight,
  deltaE2000,
  deltaE2000Lab,
  desaturate,
  hexToRgb,
  simulateColorBlind,
  relativeLuminance,
} from './colorMath';

describe('Reshaped Earth metric copy and formatting', () => {
  it('offers only the four reviewed 2020 measures', () => {
    expect(RESHAPED_METRIC_IDS).toEqual(['population', 'gdp', 'co2', 'lights']);
    expect(
      RESHAPED_METRICS.every(
        (metric) =>
          metric.year === 2020 &&
          metric.title.zh &&
          metric.title.en &&
          metric.sourceId,
      ),
    ).toBe(true);
    expect(isReshapedMetric('gdp')).toBe(true);
    expect(
      RESHAPED_METRICS.find((metric) => metric.id === 'gdp')?.unit.en,
    ).toContain('2021');
    for (const invalid of [null, undefined, '', 0, 'built-area', 'GDP'])
      expect(isReshapedMetric(invalid)).toBe(false);
  });

  it.each([
    [12345, 'zh', '1.2万'],
    [123456789, 'zh', '1.2亿'],
    [1234567, 'en', '1.2 million'],
    [1234567890, 'en', '1.2 billion'],
    [9999, 'zh', '9,999'],
    [999999, 'en', '999,999'],
  ] as const)('formats %s in %s as %s', (value, locale, expected) => {
    for (const metric of ['population', 'gdp', 'co2'] as const)
      expect(formatReshapedValue(value, metric, locale)).toBe(expected);
  });

  it('keeps zero numeric and missing explicit in both languages', () => {
    for (const metric of RESHAPED_METRIC_IDS) {
      expect(formatReshapedValue(0, metric, 'zh')).toBe('0');
      expect(formatReshapedValue(0, metric, 'en')).toBe('0');
      expect(formatReshapedValue(null, metric, 'zh')).toBe('缺失');
      expect(formatReshapedValue(null, metric, 'en')).toBe('missing');
    }
  });

  it('formats relative night-light indices without population or currency suffixes', () => {
    expect(formatReshapedValue(12345678.4, 'lights', 'zh')).toBe('12,345,678');
    expect(formatReshapedValue(12345678.4, 'lights', 'en')).toBe('12,345,678');
  });

  it('uses shared area bands and localized small-number formatting', () => {
    expect(areaRatioBand(0.1)).toBe(0);
    expect(areaRatioBand(0.1001)).toBe(1);
    expect(areaRatioBand(1)).toBe(3);
    expect(areaRatioBand(10)).toBe(6);
    expect(formatReshapedShare(0, 'en')).toBe('0%');
    expect(formatReshapedShare(0.0000001, 'en')).toBe('<0.001%');
    expect(formatReshapedShare(0.00032, 'en')).toBe('0.032%');
    expect(formatReshapedShare(0.037, 'en')).toBe('3.7%');
    expect(formatReshapedShare(0.187, 'en')).toBe('18.7%');
    expect(formatReshapedAreaRatio(0.027, 'en')).toBe('about 1/37');
    expect(formatReshapedAreaRatio(86.4, 'en')).toBe('86×');
  });

  it.each(['zh', 'en'] as const)(
    'formats every share and ratio interval boundary in %s',
    (locale) => {
      for (const [share, formatted] of [
        [0, '0%'],
        [0.000009, '<0.001%'],
        [0.00001, '0.001%'],
        [0.001, '0.1%'],
        [0.0052, '0.52%'],
        [0.037, '3.7%'],
        [0.1, '10.0%'],
      ] as const)
        expect(formatReshapedShare(share, locale)).toBe(formatted);
      for (const [ratio, formatted] of [
        [0.1, '0.10×'],
        [0.45, '0.45×'],
        [1, '1.0×'],
        [9.9, '9.9×'],
        [10, '10×'],
        [86, '86×'],
      ] as const)
        expect(formatReshapedAreaRatio(ratio, locale)).toBe(formatted);
      expect(formatReshapedAreaRatio(1 / 36, locale)).toBe(
        locale === 'zh' ? '约 1/36' : 'about 1/36',
      );
      for (const [ratio, band] of [
        [0, 0],
        [0.1, 0],
        [0.25, 1],
        [0.5, 2],
        [2, 4],
        [4, 5],
        [10, 6],
      ] as const)
        expect(areaRatioBand(ratio)).toBe(band);
    },
  );

  it('keeps the published palettes separated under colour-blind checks', async () => {
    const { RESHAPED_METRIC_THEMES } = await import('./metrics');
    for (const theme of Object.values(RESHAPED_METRIC_THEMES)) {
      for (const mode of ['protan', 'deutan', 'tritan'] as const) {
        const colours = theme.palette.map((hex) =>
          simulateColorBlind(hexToRgb(hex), mode),
        );
        for (let i = 1; i < colours.length; i += 1)
          expect(
            deltaE2000(colours[i - 1]!, colours[i]!),
          ).toBeGreaterThanOrEqual(10);
      }
      const border = hexToRgb(theme.border);
      for (let index = 0; index < theme.palette.length; index += 1) {
        const hex = theme.palette[index]!;
        const neighbours = [
          theme.palette[index - 1],
          theme.palette[index + 1],
        ].filter((value): value is string => Boolean(value));
        expect(
          Math.max(
            contrastRatio(border, hexToRgb(hex)),
            contrastRatio(hexToRgb(theme.borderLight), hexToRgb(hex)),
          ),
          `adaptive border vs ${hex}`,
        ).toBeGreaterThanOrEqual(3);
        for (const neighbour of neighbours)
          expect(
            deltaE2000(desaturate(hexToRgb(hex)), hexToRgb(neighbour)),
          ).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('matches published CIEDE2000 reference pairs including wrapped hue', () => {
    // Sharma, Wu and Dalal (2005), supplementary test data.
    for (const [a, b, expected] of [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
      [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
      [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1],
      [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
      [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
    ] as const) {
      expect(deltaE2000Lab([...a], [...b])).toBeCloseTo(expected, 4);
      expect(deltaE2000Lab([...b], [...a])).toBeCloseTo(expected, 4);
    }
  });

  it('keeps lights brightness monotonic and its darkest band distinct under actual lighting', async () => {
    const { RESHAPED_METRIC_THEMES } = await import('./metrics');
    const theme = RESHAPED_METRIC_THEMES.lights;
    const luminance = theme.palette.map((hex) =>
      relativeLuminance(hexToRgb(hex)),
    );
    for (let i = 1; i < luminance.length; i++)
      expect(luminance[i]).toBeGreaterThan(luminance[i - 1]!);
    for (const factor of [
      theme.light.ambient,
      theme.light.ambient + theme.light.directional,
    ])
      expect(
        contrastRatio(
          applyLinearLight(hexToRgb(theme.palette[0]!), factor),
          applyLinearLight(hexToRgb(theme.ocean), factor),
        ),
      ).toBeGreaterThanOrEqual(1.5);
  });
});
