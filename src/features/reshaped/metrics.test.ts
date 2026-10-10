import { describe, expect, it } from 'vitest';
import {
  formatReshapedValue,
  isReshapedMetric,
  RESHAPED_METRICS,
  RESHAPED_METRIC_IDS,
} from './metrics';

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
});
