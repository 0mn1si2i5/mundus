/**
 * The accepted publication set is separate from presentation definitions so a
 * GDP fallback changes URL validation and controls without importing the full
 * offline manifest or changing stable padding bits. metrics.ts owns themes/copy.
 */
export const RESHAPED_PUBLISHED_METRIC_IDS = [
  'population',
  'gdp',
  'co2',
  'lights',
] as const;
