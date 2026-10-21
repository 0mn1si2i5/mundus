export const EARTH_RADIUS_KM: number;
export const PROFILE_BIN_COUNT: number;
export interface PopulationCells {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  population: Float64Array;
  total: number;
}
export interface PopulationProfile {
  histogram: Float64Array;
  total: number;
}
export function prepareCells(
  values: ArrayLike<number>,
  width: number,
  height: number,
  unit?: number,
): PopulationCells;
export function populationProfile(
  cells: PopulationCells,
  latitude: number,
  longitude: number,
): PopulationProfile;
export function populationWithin(
  profile: PopulationProfile,
  radiusKm: number,
): number;
export function radiusForPopulation(
  profile: PopulationProfile,
  target: number,
): number;
export function radiusForShare(
  profile: PopulationProfile,
  share: number,
): number;
