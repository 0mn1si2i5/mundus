import type { InverseField } from './inverseFormat.mjs';
export const ADAPTIVE_MAX_DEPTH: 8;
export const INVERSE_TEXTURE_WIDTH: 1024;
export const ADAPTIVE_LEAF_BIT: number;
export const ADAPTIVE_LEAF_MASK: number;
export function wrapDisplacementLongitude(value: number): number;
export function equalAreaToLatitudeCoordinate(y: number): number;
export function latitudeCoordinateToEqualArea(y: number): number;
export function locateAdaptiveLeafAtDomain(
  field: InverseField,
  x: number,
  y: number,
): { node: number; leaf: number; fx: number; fy: number };
export function sampleInverseLatitude(
  field: InverseField | null,
  x: number,
  latitude: number,
): [number, number];
export function morphLatitude(from: number, to: number, t: number): number;
export function locateAdaptiveLeaf(
  field: InverseField,
  x: number,
  y: number,
): { node: number; leaf: number; fx: number; fy: number };
export function sampleInverseDisplacement(
  field: InverseField | null,
  x: number,
  y: number,
): [number, number];
export function sampleInverseCoordinates(
  field: InverseField | null,
  x: number,
  y: number,
): [number, number];
export function inverseTextureBytes(field: InverseField): number;
export function inverseTextureBytesFromDescriptor(field: {
  encoding: string;
  width: number;
  height: number;
  treeNodes?: number;
  leafCount?: number;
}): number;
export function reshapedMorphTextureBytes(
  fromBytes: number,
  toBytes: number,
  maxRasterId: number,
  width?: number,
  height?: number,
): number;
export interface AdaptiveLayout {
  bounds: number[][];
  leaves: number[];
  latticeWidth: number;
  latticeHeight: number;
}
export function adaptiveLeafLayout(field: InverseField): AdaptiveLayout;
export function sampleAdaptiveLeafCoordinates(
  field: InverseField,
  node: number,
  x: number,
  y: number,
  layout: AdaptiveLayout,
): [number, number];
export function measureAdaptiveEdgeContinuity(field: InverseField): {
  balanced: boolean;
  maximumDepthDifference: number;
  maxDegrees: number;
  edgesChecked: number;
};
