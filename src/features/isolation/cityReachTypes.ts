import type { GeoPoint } from '../globe/geo';
import type { CityReachLevel } from './cityReachLevel';

export type CityReachQuality = 'low';
export type CityReachCityStatus =
  | 'ok'
  | 'root'
  | 'no_larger_reachable'
  | 'merged_at_resolution'
  | 'transport_missing'
  | 'disputed';

export interface CityReachCity {
  id: number;
  ownerIndex: number;
  name: { en: string; zh: string | null };
  country: { en: string; zh: string | null };
  nameMatchType: 'override' | 'exact' | 'none';
  population: number;
  point: GeoPoint;
  centrePoint: GeoPoint | null;
  threshold: number | null;
  parentId: number | null;
  status: CityReachCityStatus;
  mergedIntoId: number | null;
}

export interface CityReachGrid {
  width: number;
  height: number;
  west: number;
  north: number;
  step: number;
  wrapLongitude: boolean;
}

export interface CityReachAssetIdentity {
  path: string;
  sha256: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface CityReachTextureAsset extends CityReachAssetIdentity {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CityReachQualityTier {
  stride: number;
  width: number;
  height: number;
  gpuBytes: number;
  densityStride: number;
  densityGpuBytes: number;
  cpuOwnerBytes: number;
  transitionGpuBytes: number;
}

export interface CityReachManifest {
  id: 'city-reach';
  formatVersion: 1;
  grid: CityReachGrid;
  levels: readonly CityReachLevel[];
  defaultLevel: CityReachLevel;
  defaultQuality: 'low';
  universeMinPopulation: 100000;
  recordCount: number;
  cityAsset: CityReachAssetIdentity;
  densityAsset: CityReachTextureAsset;
  qualityTiers: Record<CityReachQuality, CityReachQualityTier>;
  ownershipAssets: Record<
    CityReachLevel,
    Record<CityReachQuality, readonly CityReachTextureAsset[]>
  >;
}

export interface CityReachMetadata {
  manifest: CityReachManifest;
  cities: readonly CityReachCity[];
  byId: ReadonlyMap<number, CityReachCity>;
  /** Already reviewed bilingual centres only; this does not extend the name gate. */
  inspectableCities: readonly CityReachCity[];
}

export interface DecodedOwnerTile {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Raw data bytes: north-first rows, no colour conversion, alpha fixed at 255. */
  rgba: Uint8Array;
  owners: Uint16Array;
}

export interface DecodedDensityTexture {
  width: number;
  height: number;
  /** Shared across all levels; density is in R, G/B are zero, alpha is opaque. */
  rgba: Uint8Array;
}

export interface CityReachFrame {
  level: CityReachLevel;
  quality: CityReachQuality;
  grid: CityReachGrid;
  stride: number;
  densityStride: number;
  width: number;
  height: number;
  tiles: readonly DecodedOwnerTile[];
  density: DecodedDensityTexture;
  /** Values are ownerIndex, not GHSL city id. */
  ownerIds: ReadonlySet<number>;
}

interface SampledCell {
  row: number;
  column: number;
  density: number | null;
}

export type CityReachPointSelection =
  | (SampledCell & {
      status: 'owned';
      ownerIndex: number;
      city: CityReachCity;
    })
  | (SampledCell & { status: 'unreachable' | 'disputed' })
  | { status: 'outside-coverage' };
