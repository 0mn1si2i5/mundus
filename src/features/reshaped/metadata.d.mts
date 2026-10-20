import type { ReshapedUnit, ReshapedValueRow } from './reshapedData';
export function encodeUnits(
  classification: { countries: readonly Record<string, unknown>[] },
  countryNames?: ReadonlyMap<string, { en: string; zh: string }>,
): unknown;
export function encodeValues(
  classification: { countries: readonly Record<string, unknown>[] },
  metrics: Record<string, unknown>,
  fields: Record<string, unknown>,
  countryNames?: ReadonlyMap<string, { en: string; zh: string }>,
  publishedMetrics?: readonly string[],
  sourceIds?: Record<string, string>,
): unknown;
export function decodeUnits(asset: unknown): ReshapedUnit[];
export function decodeValues(
  asset: unknown,
  units: readonly ReshapedUnit[],
): ReshapedValueRow[];
