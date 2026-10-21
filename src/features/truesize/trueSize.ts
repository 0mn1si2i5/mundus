import type { Position } from 'geojson';
import type { GeoPoint } from '../antipodes/geography';
import { COUNTRY_NAMES } from '../globe/countryNames';
import { getCountryDataset, type CountryFeature } from '../globe/countryData';
import {
  TRUE_SIZE_DEFAULT_COUNTRY,
  areaKm2,
  mercatorInflation,
  outlineRings,
  placeGeometry,
  trueSizeAnchor,
  type PlacedCountry,
} from './trueSizeGeometry';

export { TRUE_SIZE_DEFAULT_COUNTRY } from './trueSizeGeometry';

let countryIds: ReadonlySet<string> | undefined;

/** Country units that have both a 1:110m geometry and a reviewed name. */
export function trueSizeCountryIds(): ReadonlySet<string> {
  countryIds ??= new Set(
    getCountryDataset()
      .countries.features.map((feature) => feature.properties.countryId)
      .filter((id) => Object.hasOwn(COUNTRY_NAMES, id)),
  );
  return countryIds;
}

export function isTrueSizeCountry(value: string | null): value is string {
  return value !== null && trueSizeCountryIds().has(value);
}

export function parseTrueSizeCountryParam(value: string | null): string {
  return isTrueSizeCountry(value) ? value : TRUE_SIZE_DEFAULT_COUNTRY;
}

export interface TrueSizePlacement {
  countryId: string;
  /** Centroid of the country's largest part at home. */
  anchor: GeoPoint;
  areaKm2: number;
  homeRings: Position[][];
  placed: PlacedCountry;
  /** Web Mercator inflation of the outline at home and at the point. */
  homeInflation: number | null;
  placedInflation: number | null;
}

function findFeature(countryId: string): CountryFeature | null {
  return (
    getCountryDataset().countries.features.find(
      (feature) => feature.properties.countryId === countryId,
    ) ?? null
  );
}

const homeCache = new Map<
  string,
  Pick<
    TrueSizePlacement,
    'anchor' | 'areaKm2' | 'homeRings' | 'homeInflation'
  > & { feature: CountryFeature }
>();

export function placeTrueSizeCountry(
  countryId: string,
  target: GeoPoint,
): TrueSizePlacement | null {
  let home = homeCache.get(countryId);
  if (!home) {
    const feature = findFeature(countryId);
    if (!feature) return null;
    home = {
      feature,
      anchor: trueSizeAnchor(feature.geometry),
      areaKm2: areaKm2(feature.geometry),
      homeRings: outlineRings(feature.geometry),
      homeInflation: mercatorInflation(feature.geometry),
    };
    homeCache.set(countryId, home);
  }
  const placed = placeGeometry(home.feature.geometry, home.anchor, target);
  return {
    countryId,
    anchor: home.anchor,
    areaKm2: home.areaKm2,
    homeRings: home.homeRings,
    homeInflation: home.homeInflation,
    placed,
    placedInflation: mercatorInflation(placed.geometry),
  };
}

export function countryAreaKm2(countryId: string): number | null {
  const feature = findFeature(countryId);
  return feature ? areaKm2(feature.geometry) : null;
}
