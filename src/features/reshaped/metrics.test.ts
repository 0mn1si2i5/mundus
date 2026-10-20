import { describe, expect, it } from 'vitest';
import {
  areaRatioBand,
  formatReshapedAreaRatio,
  formatReshapedShare,
  formatReshapedValue,
  isReshapedMetric,
  RESHAPED_METRICS,
  RESHAPED_METRIC_IDS,
  RESHAPED_METRIC_THEMES,
  RESHAPED_METRIC_HUE_REFERENCES,
} from './metrics';
import {
  contrastRatio,
  compositeLinear,
  applyLinearLight,
  deltaE2000,
  deltaE2000Lab,
  desaturate,
  hexToRgb,
  simulateColorBlind,
  relativeLuminance,
  rgbToLch,
  hueDifference,
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

  it('preserves the reviewed diverging hue families, neutral chroma and brightness order', () => {
    expect(RESHAPED_METRIC_HUE_REFERENCES).toEqual({
      population: { smaller: 180, larger: 45 },
      gdp: { smaller: 305, larger: 80 },
      co2: { smaller: 245, larger: 60 },
      lights: { smaller: 265, larger: 80 },
    });
    for (const [metric, theme] of Object.entries(RESHAPED_METRIC_THEMES)) {
      expect(theme.palette).toHaveLength(7);
      const colours = theme.palette.map(hexToRgb);
      const lch = colours.map(rgbToLch);
      const reference =
        RESHAPED_METRIC_HUE_REFERENCES[
          metric as keyof typeof RESHAPED_METRIC_HUE_REFERENCES
        ];
      for (const index of [0, 1, 2])
        expect(
          hueDifference(lch[index]![2], reference.smaller),
        ).toBeLessThanOrEqual(25);
      for (const index of [4, 5, 6])
        expect(
          hueDifference(lch[index]![2], reference.larger),
        ).toBeLessThanOrEqual(25);
      for (const index of [0, 1, 2, 4, 5, 6])
        expect(lch[3]![1]).toBeLessThan(lch[index]![1]);
      const luminance = colours.map(relativeLuminance);
      if (metric === 'lights') {
        for (let i = 1; i < luminance.length; i += 1)
          expect(luminance[i]).toBeGreaterThan(luminance[i - 1]!);
      } else {
        for (let i = 1; i <= 3; i += 1)
          expect(luminance[i]).toBeGreaterThan(luminance[i - 1]!);
        for (let i = 4; i < luminance.length; i += 1)
          expect(luminance[i]).toBeLessThan(luminance[i - 1]!);
      }
    }
  });

  it('separates every adjacent band and padding from both neighbours under each colour-blind simulation', () => {
    for (const theme of Object.values(RESHAPED_METRIC_THEMES)) {
      const colours = theme.palette.map(hexToRgb);
      const padding = colours.map((colour) => desaturate(colour));
      for (const mode of ['protan', 'deutan', 'tritan'] as const) {
        const simulated = colours.map((colour) =>
          simulateColorBlind(colour, mode),
        );
        for (let i = 1; i < simulated.length; i += 1)
          expect(
            deltaE2000(simulated[i - 1]!, simulated[i]!),
          ).toBeGreaterThanOrEqual(10);
        for (let i = 0; i < colours.length; i += 1) {
          for (const j of [i - 1, i + 1]) {
            if (!colours[j]) continue;
            expect(deltaE2000(padding[i]!, colours[j]!)).toBeGreaterThanOrEqual(
              10,
            );
            expect(
              deltaE2000(simulateColorBlind(padding[i]!, mode), simulated[j]!),
            ).toBeGreaterThanOrEqual(10);
          }
        }
      }
    }
  });

  it('makes the same casing distinguishable against the ink over land, padding and ocean', () => {
    for (const [metric, theme] of Object.entries(RESHAPED_METRIC_THEMES)) {
      const isNight = metric === 'lights';
      expect(theme.casing).toBe(isNight ? '#9aa7b8' : '#fbf7ee');
      expect(theme.casingOpacity).toBe(isNight ? 0.35 : 0.85);
      const colours = theme.palette.map(hexToRgb);
      const backgrounds = [
        ...colours,
        ...colours.map((colour) => desaturate(colour)),
        hexToRgb(theme.ocean),
      ];
      const ink = hexToRgb(theme.border);
      const casing = hexToRgb(theme.casing);
      const threshold = isNight ? 2 : 3;
      for (const factor of [
        1,
        theme.light.ambient,
        theme.light.ambient + theme.light.directional,
      ]) {
        for (const background of backgrounds)
          expect(
            contrastRatio(
              applyLinearLight(ink, factor),
              applyLinearLight(
                compositeLinear(casing, background, theme.casingOpacity),
                factor,
              ),
            ),
          ).toBeGreaterThanOrEqual(threshold);
        expect(
          contrastRatio(
            applyLinearLight(ink, factor),
            applyLinearLight(hexToRgb(theme.selection), factor),
          ),
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('measures CIELCh hue on a circle and composites casing in linear RGB', () => {
    expect(rgbToLch([1, 1, 1])[0]).toBeCloseTo(100, 4);
    expect(rgbToLch([0, 0, 0])).toEqual([0, 0, 0]);
    expect(hueDifference(350, 10)).toBe(20);
    expect(hueDifference(10, 350)).toBe(20);
    expect(hueDifference(0, 180)).toBe(180);
    const grey = compositeLinear([1, 1, 1], [0, 0, 0], 0.5);
    for (const channel of grey) expect(channel).toBeCloseTo(0.735356983, 8);
    expect(relativeLuminance(grey)).toBeCloseTo(0.5, 8);
    expect(compositeLinear([0.2, 0.5, 1], [0, 0, 0], 0)).toEqual([0, 0, 0]);
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

  it('keeps lights brightness monotonic and its darkest band distinct under actual lighting', () => {
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
