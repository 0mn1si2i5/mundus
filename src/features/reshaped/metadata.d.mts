import type { ReshapedUnit, ReshapedValueRow } from './reshapedData';
export const AREA_RATIO_LOG2_SCALE: number;
export const AREA_RATIO_MAX_RELATIVE_ERROR: number;
export function decodeNumericColumn(
  encoded: string,
  count: number,
  bytes: number,
  kind: string,
): number[];
export function decodeUnits(asset: unknown): ReshapedUnit[];
export function decodeValues(
  asset: unknown,
  units: readonly ReshapedUnit[],
): ReshapedValueRow[];
