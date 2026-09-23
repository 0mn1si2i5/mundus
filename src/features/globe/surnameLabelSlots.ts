import { geoBounds, geoContains } from 'd3-geo';
import { Vector3 } from 'three';
import type { Feature, Geometry } from 'geojson';
import type { CountryFeature } from './countryData';
import { geoToVector3, vector3ToGeo, type GeoPoint } from './geo';
import {
  getSurnameWordmarkAngularFootprintDegrees,
  getSurnameWordmarkHeightRatio,
  getSurnameWordmarkWorldWidth,
  type SurnameWordmark,
} from '../surnames/surnameWordmark';
import generatedSlots from '../../data/generated/surname-label-slots.json' with { type: 'json' };

export type SurnameLabelSlotLayout = 'straight' | 'arched';

export interface SurnameLabelSlot {
  layout: SurnameLabelSlotLayout;
  center: GeoPoint;
  rotationDegrees: number;
  curvature: number;
  maxAngularDegrees: number;
  squareMax?: number;
  oceanDirection: 'north' | 'east' | 'south' | 'west' | 'none';
  landSafe?: boolean;
  countryScaleCap?: number;
  neighborSafe?: number;
  localClearance?: number;
  areaSteradians?: number;
}

const DIRECTIONS: ReadonlyArray<{
  name: SurnameLabelSlot['oceanDirection'];
  latitude: number;
  longitude: number;
}> = [
  { name: 'south', latitude: -1, longitude: 0 },
  { name: 'east', latitude: 0, longitude: 1 },
  { name: 'west', latitude: 0, longitude: -1 },
  { name: 'north', latitude: 1, longitude: 0 },
  { name: 'none', latitude: 0, longitude: 0 },
];

const GENERATED_SLOTS = generatedSlots.slots as Record<
  string,
  readonly SurnameLabelSlot[]
>;
const MIN_SEARCH_ANGULAR_DEGREES = 0.02;
// Search the actual wordmark envelope beyond the old country-card bound, but
// keep the center on the selected country. Its glyphs may still overflow into
// ocean, which is the useful peninsula/island case without drifting offshore.
const MAX_SEARCH_ANGULAR_DEGREES = 20;
const SEARCH_STEPS = 12;
const MAX_CENTER_OFFSET_DEGREES = 6;

type CountryBounds = readonly [[number, number], [number, number]];
const COUNTRY_BOUNDS_CACHE = new WeakMap<
  object,
  ReadonlyMap<string, CountryBounds>
>();

/**
 * Creates a small deterministic candidate set. The geometry build can use the
 * same function with 50m features; the runtime only receives the selected
 * compact candidate rather than raw country polygons.
 */
export function createSurnameLabelSlotCandidates(
  anchor: GeoPoint,
  clearanceDegrees: number,
  layout: SurnameLabelSlotLayout,
): readonly SurnameLabelSlot[] {
  const base = Math.max(0.45, Math.min(18, clearanceDegrees * 2.4));
  const rotations = layout === 'arched' ? [0, 22, -22] : [0, 90, -90];
  return rotations.flatMap((rotationDegrees) =>
    DIRECTIONS.map((direction) => ({
      layout,
      center: {
        latitude: clampLatitude(
          anchor.latitude + direction.latitude * base * 0.18,
        ),
        longitude: normalizeLongitude(
          anchor.longitude +
            (direction.longitude * base * 0.18) /
              Math.max(0.2, Math.cos((anchor.latitude * Math.PI) / 180)),
        ),
      },
      rotationDegrees,
      curvature: layout === 'arched' ? 0.24 : 0,
      maxAngularDegrees: base,
      oceanDirection: direction.name,
      countryScaleCap: Math.min(20, Math.max(0.35, base)),
    })),
  );
}

/**
 * A candidate's center stays on its own country while sampled glyph envelope
 * points must stay out of other country land. This permits island and
 * peninsula labels to read into ocean without drifting offshore.
 */
export function isSurnameLabelSlotAllowed(
  slot: SurnameLabelSlot,
  countryId: string,
  countries: readonly CountryFeature[],
  wordmarkOrAngular?: SurnameWordmark | number,
  angularDegrees?: number,
): boolean {
  const wordmark =
    typeof wordmarkOrAngular === 'object' ? wordmarkOrAngular : undefined;
  const radius =
    typeof wordmarkOrAngular === 'number'
      ? wordmarkOrAngular
      : (angularDegrees ??
        (wordmark
          ? getSurnameWordmarkAngularFootprintDegrees(
              getSurnameWordmarkWorldWidth(slot.maxAngularDegrees, wordmark),
              wordmark,
            )
          : slot.maxAngularDegrees));
  const samples = sampleSurnameLabelEnvelope(slot, radius, wordmark);
  const ownCountry = countries.find(
    (country) => country.properties.countryId === countryId,
  );
  if (
    ownCountry &&
    !geoContains(ownCountry, [slot.center.longitude, slot.center.latitude])
  ) {
    return false;
  }
  const possibleNeighbors = countriesNearSamples(countries, samples);
  return !possibleNeighbors.some(
    (country) =>
      country.properties.countryId !== countryId &&
      samples.some((point) =>
        geoContains(country, [point.longitude, point.latitude]),
      ),
  );
}

function countriesNearSamples(
  countries: readonly CountryFeature[],
  samples: readonly GeoPoint[],
): readonly CountryFeature[] {
  if (countries.length === 0) return countries;
  const boundsById = getCountryBounds(countries);
  const latitudes = samples.map((point) => point.latitude);
  const longitudes = samples.map((point) => point.longitude);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const crossesDateLine = east - west > 180;
  return countries.filter((country) => {
    const bounds = boundsById.get(country.properties.countryId);
    if (!bounds) return true;
    const [[countryWest, countrySouth], [countryEast, countryNorth]] = bounds;
    if (countryNorth < south || countrySouth > north) return false;
    if (crossesDateLine || countryEast - countryWest > 180) return true;
    return countryEast >= west && countryWest <= east;
  });
}

function getCountryBounds(
  countries: readonly CountryFeature[],
): ReadonlyMap<string, CountryBounds> {
  const cached = COUNTRY_BOUNDS_CACHE.get(countries);
  if (cached) return cached;
  const bounds = new Map<string, CountryBounds>();
  for (const country of countries) {
    bounds.set(country.properties.countryId, geoBounds(country));
  }
  COUNTRY_BOUNDS_CACHE.set(countries, bounds);
  return bounds;
}

export function sampleSurnameLabelEnvelope(
  slot: SurnameLabelSlot,
  angularDegrees = slot.maxAngularDegrees,
  wordmark?: SurnameWordmark,
  samples: readonly number[] = [-1, -0.5, 0, 0.5, 1],
): readonly GeoPoint[] {
  const radius = Math.max(0.005, angularDegrees);
  const heightRatio = wordmark ? getSurnameWordmarkHeightRatio(wordmark) : 0.42;
  const halfWidth = radius / Math.sqrt(1 + heightRatio ** 2);
  const halfHeight = halfWidth * heightRatio;
  const angle = (slot.rotationDegrees * Math.PI) / 180;
  const center = geoToVector3(slot.center).normalize();
  const latitude = (slot.center.latitude * Math.PI) / 180;
  const longitude = (slot.center.longitude * Math.PI) / 180;
  const east = new Vector3(Math.cos(longitude), 0, -Math.sin(longitude));
  const north = new Vector3(
    -Math.sin(latitude) * Math.sin(longitude),
    Math.cos(latitude),
    -Math.sin(latitude) * Math.cos(longitude),
  );
  const rotatedEast = east
    .clone()
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(north, Math.sin(angle));
  const rotatedNorth = north
    .clone()
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(east, -Math.sin(angle));
  const points: GeoPoint[] = [];
  // Sample the full envelope, not only its six corner/edge points. A large
  // wordmark can cross a neighbouring polygon through its middle while all
  // six old probes remain outside it.
  for (const along of samples) {
    for (const across of samples) {
      const tangent = rotatedEast
        .clone()
        .multiplyScalar(along * halfWidth)
        .addScaledVector(rotatedNorth, across * halfHeight);
      const tangentLength = tangent.length();
      const surface =
        tangentLength < 1e-8
          ? center.clone()
          : center
              .clone()
              .multiplyScalar(Math.cos(tangentLength))
              .addScaledVector(tangent.normalize(), Math.sin(tangentLength));
      points.push(vector3ToGeo(surface));
    }
  }
  return points;
}

/** Selects the largest safe candidate for the requested word layout. */
export function chooseSurnameLabelSlot(
  countryId: string,
  anchor: { point: GeoPoint; clearanceDegrees: number },
  wordmark: SurnameWordmark,
  countries: readonly CountryFeature[],
): SurnameLabelSlot | null {
  const candidatePool = getSurnameLabelCandidatePool(
    countryId,
    anchor,
    wordmark,
    countries,
  );
  return chooseLargestSurnameLabelSlot(candidatePool);
}

/**
 * Returns the next safe world-space candidate after the current one has been
 * covered by a desktop/mobile shell obstacle. This keeps the camera under
 * user control while still giving a selected country another readable place
 * on the globe.
 */
export function chooseAlternativeSurnameLabelSlot(
  countryId: string,
  anchor: { point: GeoPoint; clearanceDegrees: number },
  wordmark: SurnameWordmark,
  countries: readonly CountryFeature[],
  current: SurnameLabelSlot,
): SurnameLabelSlot | null {
  const currentKey = surnameLabelSlotKey(current);
  const candidatePool = getSurnameLabelCandidatePool(
    countryId,
    anchor,
    wordmark,
    countries,
  ).filter((candidate) => surnameLabelSlotKey(candidate) !== currentKey);
  return chooseLargestSurnameLabelSlot(candidatePool);
}

function getSurnameLabelCandidatePool(
  countryId: string,
  anchor: { point: GeoPoint; clearanceDegrees: number },
  wordmark: SurnameWordmark,
  countries: readonly CountryFeature[],
): readonly SurnameLabelSlot[] {
  const generatedCandidates = GENERATED_SLOTS[countryId]?.filter(
    (slot) => slot.layout === wordmark.layout && slot.maxAngularDegrees > 0,
  );
  // Keep the full generated pool when its safety pass found no candidate. The
  // smaller runtime envelope fallback below can still be safe for compact or
  // densely bordered countries, while an empty filtered array could not be
  // recovered with nullish coalescing.
  const candidates =
    generatedCandidates && generatedCandidates.length > 0
      ? generatedCandidates
      : createSurnameLabelSlotCandidates(
          anchor.point,
          anchor.clearanceDegrees,
          wordmark.layout,
        );
  const safeCandidates = candidates.filter((slot) => slot.landSafe);
  const candidateSource =
    safeCandidates.length > 0 ? safeCandidates : candidates;
  const rankedCandidates = [...candidates].sort(
    (a, b) =>
      Number(Boolean(b.landSafe)) - Number(Boolean(a.landSafe)) ||
      b.maxAngularDegrees - a.maxAngularDegrees ||
      Math.abs(a.rotationDegrees) - Math.abs(b.rotationDegrees),
  );
  const evaluatedCandidates =
    safeCandidates.length > 0
      ? candidateSource
      : expandCandidateCenters(rankedCandidates, anchor.point);
  const candidatePool = evaluatedCandidates
    .map((slot) => {
      if (slot.landSafe && slot.squareMax !== undefined) {
        return {
          ...slot,
          maxAngularDegrees:
            getSurnameWordmarkHeightRatio(wordmark) >= 0.7
              ? slot.squareMax
              : slot.maxAngularDegrees,
        };
      }
      return maximizeSurnameLabelSlot(slot, countryId, countries, wordmark);
    })
    .filter((slot): slot is SurnameLabelSlot => slot !== null);
  return candidatePool;
}

function chooseLargestSurnameLabelSlot(
  candidatePool: readonly SurnameLabelSlot[],
): SurnameLabelSlot | null {
  if (candidatePool.length === 0) return null;
  const largest = Math.max(
    ...candidatePool.map((candidate) => candidate.maxAngularDegrees),
  );
  // Keep a horizontal wordmark whenever it gives up only a small amount of
  // area. A 90-degree label is reserved for genuinely narrow or blocked
  // countries; otherwise the atlas becomes visually noisy even when the
  // geometry solver found a nearly equivalent horizontal fit.
  const horizontal = candidatePool.filter(
    (candidate) =>
      candidate.layout === 'straight' &&
      Math.abs(candidate.rotationDegrees) < 1 &&
      candidate.maxAngularDegrees >= largest * 0.85,
  );
  return (
    [...(horizontal.length > 0 ? horizontal : candidatePool)].sort(
      (a, b) =>
        b.maxAngularDegrees - a.maxAngularDegrees ||
        Math.abs(a.rotationDegrees) - Math.abs(b.rotationDegrees) ||
        a.oceanDirection.localeCompare(b.oceanDirection),
    )[0] ?? null
  );
}

function surnameLabelSlotKey(slot: SurnameLabelSlot): string {
  return `${slot.layout}:${slot.rotationDegrees}:${slot.center.latitude.toFixed(5)}:${slot.center.longitude.toFixed(5)}`;
}

function expandCandidateCenters(
  candidates: readonly SurnameLabelSlot[],
  anchor: GeoPoint,
): readonly SurnameLabelSlot[] {
  const expanded = candidates.flatMap((slot) => {
    const direction = DIRECTIONS.find(
      (candidate) => candidate.name === slot.oceanDirection,
    );
    if (!direction || slot.oceanDirection === 'none') return [slot];
    // The old candidates only moved a fraction of the anchor clearance. That
    // works for an interior card, but it prevents a peninsula/island wordmark
    // from using the open ocean that the product explicitly allows. Sample a
    // wider, still bounded set of centers along the requested ocean bearing.
    const scales = [0, 0.75, 1.5, 2.5];
    const bearingDegrees =
      direction.name === 'north'
        ? 0
        : direction.name === 'east'
          ? 90
          : direction.name === 'south'
            ? 180
            : 270;
    // Diagonal bearings matter for tapered peninsulas such as Italy, where a
    // purely north/south shift can remain trapped beside the coastline.
    return [-45, 0, 45].flatMap((bearingOffset) =>
      scales.map((scale) => ({
        ...slot,
        center: destinationPoint(
          anchor,
          Math.min(MAX_CENTER_OFFSET_DEGREES, slot.maxAngularDegrees * scale),
          bearingDegrees + bearingOffset,
        ),
      })),
    );
  });
  const seen = new Set<string>();
  return expanded.filter((slot) => {
    const key = `${slot.layout}:${slot.rotationDegrees}:${slot.oceanDirection}:${slot.center.latitude.toFixed(5)}:${slot.center.longitude.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function destinationPoint(
  point: GeoPoint,
  distanceDegrees: number,
  bearingDegrees: number,
): GeoPoint {
  const latitude = (point.latitude * Math.PI) / 180;
  const longitude = (point.longitude * Math.PI) / 180;
  const distance = (distanceDegrees * Math.PI) / 180;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(distance) +
      Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing),
  );
  const nextLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude),
      Math.cos(distance) - Math.sin(latitude) * Math.sin(nextLatitude),
    );
  return {
    latitude: clampLatitude((nextLatitude * 180) / Math.PI),
    longitude: normalizeLongitude((nextLongitude * 180) / Math.PI),
  };
}

/**
 * Expands a candidate until its actual SVG envelope reaches neighbouring land.
 * The previous build used one conservative anchor clearance for every word;
 * that made wide countries render labels far below their available area. The
 * search is deterministic and bounded, so runtime work stays tiny while the
 * selected word receives the largest safe footprint for its own aspect ratio.
 */
export function maximizeSurnameLabelSlot(
  slot: SurnameLabelSlot,
  countryId: string,
  countries: readonly CountryFeature[],
  wordmark: SurnameWordmark,
): SurnameLabelSlot | null {
  const minimum = Math.min(
    MAX_SEARCH_ANGULAR_DEGREES,
    Math.max(MIN_SEARCH_ANGULAR_DEGREES, slot.maxAngularDegrees * 0.01),
  );
  const maximum = Math.min(
    MAX_SEARCH_ANGULAR_DEGREES,
    slot.countryScaleCap ?? MAX_SEARCH_ANGULAR_DEGREES,
  );
  const isAllowedAt = (angularDegrees: number) =>
    isSurnameLabelSlotAllowed(
      { ...slot, maxAngularDegrees: angularDegrees },
      countryId,
      countries,
      wordmark,
    );

  if (!isAllowedAt(minimum)) return null;
  if (isAllowedAt(maximum)) {
    return { ...slot, maxAngularDegrees: maximum, landSafe: true };
  }

  let low = minimum;
  let high = maximum;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (isAllowedAt(middle)) low = middle;
    else high = middle;
  }
  return { ...slot, maxAngularDegrees: low, landSafe: true };
}

function clampLatitude(value: number): number {
  return Math.max(-89.5, Math.min(89.5, value));
}

function normalizeLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export type CountryGeometryFeature = Feature<Geometry, { countryId: string }>;
