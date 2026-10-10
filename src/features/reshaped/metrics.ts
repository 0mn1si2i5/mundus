export const RESHAPED_YEAR = 2020 as const;

export const RESHAPED_METRICS = [
  {
    id: 'population',
    title: { zh: '人口', en: 'population' },
    shortLabel: { zh: '人口', en: 'Population' },
    unit: { zh: '人', en: 'people' },
    sourceId: 'ghs-pop-r2023a',
    sourceName: 'GHS-POP R2023A',
    year: RESHAPED_YEAR,
    format: 'population',
  },
  {
    id: 'gdp',
    title: { zh: '经济', en: 'GDP' },
    shortLabel: { zh: 'GDP', en: 'GDP' },
    unit: { zh: '2021 国际元（PPP）', en: '2021 international dollars (PPP)' },
    sourceId: 'kummu-gdp-v4',
    sourceName: 'Kummu et al. v4',
    year: RESHAPED_YEAR,
    format: 'money',
  },
  {
    id: 'co2',
    title: { zh: '排放', en: 'CO₂ emissions' },
    shortLabel: { zh: 'CO₂', en: 'CO₂' },
    unit: { zh: '吨 CO₂ / 年', en: 't CO₂ / year' },
    sourceId: 'gridfed-v2025-1',
    sourceName: 'GCP-GridFED v2025.1',
    year: RESHAPED_YEAR,
    format: 'co2',
  },
  {
    id: 'lights',
    title: { zh: '灯光', en: 'night light index' },
    shortLabel: { zh: '夜光', en: 'Night lights' },
    unit: { zh: '相对亮度指数', en: 'relative brightness index' },
    sourceId: 'harmonized-ntl-v10',
    sourceName: 'Li et al. DMSP–VIIRS v10',
    year: RESHAPED_YEAR,
    format: 'lights',
  },
] as const;

export type ReshapedMetricId = (typeof RESHAPED_METRICS)[number]['id'];
export const RESHAPED_METRIC_IDS = RESHAPED_METRICS.map(
  (metric) => metric.id,
) as readonly ReshapedMetricId[];
export const RESHAPED_DEFAULT_METRIC: ReshapedMetricId = 'population';

export const RESHAPED_LEVELS = [
  { id: 'country', label: { zh: '国家', en: 'Country' } },
  { id: 'admin1', label: { zh: '一级行政区', en: 'Admin-1' } },
] as const;
export type ReshapedLevelId = (typeof RESHAPED_LEVELS)[number]['id'];
export const RESHAPED_LEVEL_IDS = RESHAPED_LEVELS.map(
  (level) => level.id,
) as readonly ReshapedLevelId[];
export const RESHAPED_DEFAULT_LEVEL: ReshapedLevelId = 'country';

export function isReshapedMetric(value: unknown): value is ReshapedMetricId {
  return (
    typeof value === 'string' &&
    (RESHAPED_METRIC_IDS as readonly string[]).includes(value)
  );
}

export function isReshapedLevel(value: unknown): value is ReshapedLevelId {
  return (
    typeof value === 'string' &&
    (RESHAPED_LEVEL_IDS as readonly string[]).includes(value)
  );
}

export function formatReshapedValue(
  value: number | null,
  metric: ReshapedMetricId,
  locale: 'zh' | 'en',
): string {
  if (value === null) return locale === 'zh' ? '缺失' : 'missing';
  if (metric === 'lights')
    return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      maximumFractionDigits: 0,
    }).format(value);
  const absolute = Math.abs(value);
  const divisor =
    locale === 'zh'
      ? absolute >= 1e8
        ? 1e8
        : absolute >= 1e4
          ? 1e4
          : 1
      : absolute >= 1e9
        ? 1e9
        : absolute >= 1e6
          ? 1e6
          : 1;
  const suffix =
    locale === 'zh'
      ? divisor === 1e8
        ? '亿'
        : divisor === 1e4
          ? '万'
          : ''
      : divisor === 1e9
        ? ' billion'
        : divisor === 1e6
          ? ' million'
          : '';
  return `${new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: divisor === 1 ? 0 : 1 }).format(value / divisor)}${suffix}`;
}
