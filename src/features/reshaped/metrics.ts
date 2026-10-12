import { RESHAPED_PUBLISHED_METRIC_IDS } from './publishedMetrics';
import { messages } from '../../i18n/messages';

export const RESHAPED_YEAR = 2020 as const;

const METRIC_DEFINITIONS = [
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

export const RESHAPED_AREA_RATIO_BANDS = [
  { max: 0.1, inclusive: true },
  { max: 0.25, inclusive: true },
  { max: 0.5, inclusive: true },
  { max: 2, inclusive: false },
  { max: 4, inclusive: false },
  { max: 10, inclusive: false },
  { max: Number.POSITIVE_INFINITY, inclusive: true },
] as const;

export type ReshapedMetricTheme = {
  palette: readonly string[];
  ocean: string;
  border: string;
  casing: string;
  casingOpacity: number;
  selection: string;
  graticule: string;
  light: { ambient: number; directional: number };
};

export const RESHAPED_METRIC_THEMES: Record<
  ReshapedMetricId,
  ReshapedMetricTheme
> = {
  population: {
    palette: [
      '#08201e',
      '#469b82',
      '#64d3cc',
      '#fbf6ec',
      '#f89986',
      '#c5523c',
      '#6e2e21',
    ],
    ocean: '#c7d2cd',
    border: '#241f18',
    casing: '#fbf7ee',
    casingOpacity: 0.85,
    selection: '#e8562a',
    graticule: '#6b6258',
    light: { ambient: 0.72, directional: 0.3 },
  },
  gdp: {
    palette: [
      '#49446e',
      '#9e62c2',
      '#ada4ef',
      '#f6f3ee',
      '#d4a541',
      '#8e6d16',
      '#544309',
    ],
    ocean: '#c7d2cd',
    border: '#241f18',
    casing: '#fbf7ee',
    casingOpacity: 0.85,
    selection: '#e8562a',
    graticule: '#6b6258',
    light: { ambient: 0.72, directional: 0.3 },
  },
  co2: {
    palette: [
      '#1b3340',
      '#3d8fb5',
      '#85c6eb',
      '#f5f0e9',
      '#e4a275',
      '#a5693c',
      '#663d1e',
    ],
    ocean: '#c7d2cd',
    border: '#241f18',
    casing: '#fbf7ee',
    casingOpacity: 0.85,
    selection: '#e8562a',
    graticule: '#6b6258',
    light: { ambient: 0.72, directional: 0.3 },
  },
  lights: {
    palette: [
      '#09456a',
      '#5772a2',
      '#579eea',
      '#9b9c9e',
      '#d59102',
      '#eebb77',
      '#fcf9f5',
    ],
    ocean: '#0b1424',
    border: '#0b1424',
    casing: '#9aa7b8',
    casingOpacity: 0.35,
    selection: '#7fd3ff',
    graticule: '#718096',
    light: { ambient: 0.72, directional: 0.18 },
  },
};

export type ReshapedMetricId = (typeof METRIC_DEFINITIONS)[number]['id'];

/** CIELCh hue centres for the owner-reviewed smaller / larger colour families. */
export const RESHAPED_METRIC_HUE_REFERENCES: Record<
  ReshapedMetricId,
  { smaller: number; larger: number }
> = {
  population: { smaller: 180, larger: 45 },
  gdp: { smaller: 305, larger: 80 },
  co2: { smaller: 245, larger: 60 },
  lights: { smaller: 265, larger: 80 },
};
export const RESHAPED_METRIC_BITS: Record<ReshapedMetricId, number> = {
  population: 0,
  gdp: 1,
  co2: 2,
  lights: 3,
};
const declared: readonly string[] = RESHAPED_PUBLISHED_METRIC_IDS;
export const RESHAPED_METRICS = METRIC_DEFINITIONS.filter((metric) =>
  declared.includes(metric.id),
);
export const RESHAPED_METRIC_IDS = RESHAPED_METRICS.map(
  (metric) => metric.id,
) as readonly ReshapedMetricId[];
export const RESHAPED_DEFAULT_METRIC: ReshapedMetricId = 'population';

export function areaRatioBand(ratio: number | null): number {
  if (ratio === null || !Number.isFinite(ratio)) return -1;
  const value = Math.max(0, ratio);
  if (value >= 10) return 6;
  if (value >= 4) return 5;
  if (value >= 2) return 4;
  if (value > 0.5) return 3;
  if (value > 0.25) return 2;
  if (value > 0.1) return 1;
  return 0;
}

function significantPercent(value: number, locale: 'zh' | 'en'): string {
  const maximumFractionDigits = Math.max(
    0,
    1 - Math.floor(Math.log10(Math.abs(value))),
  );
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatReshapedShare(
  share: number | null,
  locale: 'zh' | 'en',
): string {
  if (share === null || !Number.isFinite(share))
    return locale === 'zh' ? '缺失' : 'missing';
  if (share === 0) return '0%';
  const percent = Math.abs(share * 100);
  if (percent < 0.001) return '<0.001%';
  if (percent >= 10) return `${percent.toFixed(1)}%`;
  return `${significantPercent(percent, locale)}%`;
}

export function formatReshapedAreaRatio(
  ratio: number | null,
  locale: 'zh' | 'en',
): string {
  if (ratio === null || !Number.isFinite(ratio))
    return locale === 'zh' ? '缺失' : 'missing';
  if (ratio <= 0) return '0×';
  if (ratio < 0.1) {
    const denominator = Math.max(1, Math.round(1 / ratio));
    return messages[locale].reshapedReciprocal.replace(
      '{n}',
      String(denominator),
    );
  }
  if (ratio < 1) return `${ratio.toFixed(2)}×`;
  if (ratio < 10) return `${ratio.toFixed(1)}×`;
  return `${Math.round(ratio)}×`;
}

export function isReshapedMetric(value: unknown): value is ReshapedMetricId {
  return (
    typeof value === 'string' &&
    (RESHAPED_METRIC_IDS as readonly string[]).includes(value)
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
