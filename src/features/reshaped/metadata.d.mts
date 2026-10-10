import type { ReshapedUnit, ReshapedValueRow } from './reshapedData';
export function decodeUnits(asset: unknown): ReshapedUnit[];
export function decodeValues(
  asset: unknown,
  units: readonly ReshapedUnit[],
): ReshapedValueRow[];
