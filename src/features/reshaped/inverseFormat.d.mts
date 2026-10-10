export interface InverseHeader {
  formatVersion: number;
  metric: string;
  level: string;
  stepLongitude: number;
  stepS?: number;
  verticalCoordinate?: 'latitude';
  stepLatitude?: number;
  maxDepth?: number;
  treeNodes?: number;
  leafCount?: number;
  treeEncodedBytes?: number;
  cornerEncodedBytes?: number;
}
export interface RegularInverseField {
  width: number;
  height: number;
  encoding?: 'regular-float32';
  data: Float32Array;
  tree?: never;
  corners?: never;
  header?: InverseHeader;
}
export interface AdaptiveInverseField {
  width: number;
  height: number;
  encoding: 'adaptive-quadtree-int16';
  data?: never;
  tree: Uint32Array;
  corners: Int16Array;
  header: InverseHeader;
}
export type InverseField = RegularInverseField | AdaptiveInverseField;
export function decodeInverse(
  buffer: ArrayBuffer,
  expected: { metric: string; level: string },
): Promise<InverseField>;
