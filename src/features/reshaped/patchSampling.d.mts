import type {
  DecodedIdRaster,
  ReshapedRasterSample,
} from './labelSampling.mjs';
export interface LocalIdPatch {
  bbox: [number, number, number, number];
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
  atlas: { x: number; y: number; width: number; height: number };
}
export function sampleReshapedPatchLabel(
  atlas: { patches: readonly LocalIdPatch[]; raster: DecodedIdRaster } | null,
  latitude: number,
  longitude: number,
): (ReshapedRasterSample & { patch: LocalIdPatch; weight: number }) | null;
export function buildReshapedPatchBins(
  atlas: { patches: readonly LocalIdPatch[] } | null,
): Uint32Array;
