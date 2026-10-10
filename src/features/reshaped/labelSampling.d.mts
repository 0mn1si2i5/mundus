export interface DecodedIdRaster {
  width: number;
  height: number;
  ids: Uint32Array;
  padding?: Uint8Array;
  distance?: Uint8Array;
  /** Encoded distance lower-bound cap, reduced along with a display raster. */
  distanceCap?: number;
}
export interface ReshapedRasterSample {
  id: number;
  padding: number;
  distance: number;
}
export function sampleReshapedLabel(
  raster: DecodedIdRaster | null,
  latitude: number,
  longitude: number,
): ReshapedRasterSample;
