import type { InverseField } from './inverseFormat.mjs';
export function wrapDisplacementLongitude(value: number): number;
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
export function sampleInverseLatitude(
  field: InverseField | null,
  x: number,
  latitude: number,
): [number, number];
export function morphLatitude(from: number, to: number, t: number): number;
export function inverseTextureBytes(field: {
  width: number;
  height: number;
}): number;
export const inverseTextureBytesFromDescriptor: typeof inverseTextureBytes;
export function reshapedMorphTextureBytes(
  fromBytes: number,
  toBytes: number,
  maxRasterId: number,
  width?: number,
  height?: number,
): number;
