import { geoBounds, geoContains, geoDistance, geoCentroid } from 'd3-geo';
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
import generatedWordmarks from '../../data/generated/wordmark-layouts.json' with { type: 'json' };
import generatedSlots from '../../data/generated/surname-label-slots.json' with { type: 'json' };

export type SurnameLabelSlotLayout = 'straight' | 'arched';

// Wordmarks below this height/width ratio use the generated long envelope;
// at or above the square ratio they use the square envelope.
const LONG_WORDMARK_HEIGHT_RATIO = 0.42;
const SQUARE_WORDMARK_HEIGHT_RATIO = 0.82;

export interface SurnameLabelSlot {
  layout: SurnameLabelSlotLayout;
  center: GeoPoint;
  rotationDegrees: number;
  curvature: number;
  maxAngularDegrees: number;
  mediumMax?: number;
  squareMax?: number;
  strictMaxAngularDegrees?: number;
  strictMediumMax?: number;
  strictSquareMax?: number;
  oceanDirection: 'north' | 'east' | 'south' | 'west' | 'none';
  landSafe?: boolean;
  countryScaleCap?: number;
  neighborSafe?: number;
  mediumNeighborSafe?: number;
  squareNeighborSafe?: number;
  foreignClearance?: number;
  isolatedOverflow?: boolean;
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
const POLE_SAFE_COSINE = 0.12;
const POLE_SAFE_LONGITUDE_SPAN = Math.PI * 0.75;

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
  // Longitude is the only stable reading direction for a globe label. A
  // narrow country gets a smaller wordmark; rotating it makes the atlas
  // visually noisy and breaks the parallel rule.
  const rotations = [0];
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
  if (
    possibleNeighbors.some(
      (country) =>
        country.properties.countryId !== countryId &&
        samples.some((point) =>
          geoContains(country, [point.longitude, point.latitude]),
        ),
    )
  ) {
    return false;
  }
  if (!ownCountry) return true;
  const ownSamples = samples.every((point) =>
    geoContains(ownCountry, [point.longitude, point.latitude]),
  );
  if (ownSamples) return true;
  return isAllowedIsolatedOverflow(
    slot,
    countryId,
    countries,
    radius,
    wordmark,
  );
}

function isAllowedIsolatedOverflow(
  slot: SurnameLabelSlot,
  countryId: string,
  countries: readonly CountryFeature[],
  radius: number,
  wordmark?: SurnameWordmark,
): boolean {
  if (!slot.isolatedOverflow) return false;
  const strict = getStrictSlotRadius(slot, wordmark);
  if (radius <= strict + 1e-6) return false;
  const equivalentRadius = slot.areaSteradians
    ? (Math.acos(
        Math.max(-1, Math.min(1, 1 - slot.areaSteradians / (2 * Math.PI))),
      ) *
        180) /
      Math.PI
    : strict / 1.6;
  const foreignClearance =
    slot.foreignClearance ??
    nearestForeignLandDegrees(slot, countryId, countries);
  const threshold = Math.max(
    strict * 2.5,
    strict + 0.75,
    strict + equivalentRadius * 0.9,
  );
  const cap = Math.min(
    strict + equivalentRadius * 0.8,
    foreignClearance * 0.75,
    Math.max(0.35, equivalentRadius * 2.8),
    20,
  );
  return foreignClearance >= threshold && radius <= cap + 1e-6;
}

function nearestForeignLandDegrees(
  slot: SurnameLabelSlot,
  countryId: string,
  countries: readonly CountryFeature[],
): number {
  const foreign = countries.filter(
    (country) => country.properties.countryId !== countryId,
  );
  if (foreign.length === 0) return Number.POSITIVE_INFINITY;
  const center: [number, number] = [
    slot.center.longitude,
    slot.center.latitude,
  ];
  let nearest = Number.POSITIVE_INFINITY;
  for (const country of foreign) {
    nearest = Math.min(nearest, geoDistance(center, geoCentroid(country)));
    const [[west, south], [east, north]] = geoBounds(country);
    for (const point of [
      [west, south],
      [west, north],
      [east, south],
      [east, north],
    ] as Array<[number, number]>) {
      nearest = Math.min(nearest, geoDistance(center, point));
    }
  }
  return (nearest * 180) / Math.PI;
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
  const radius = (Math.max(0.0001, angularDegrees) * Math.PI) / 180;
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
  const followsLatitude = Math.abs(slot.rotationDegrees) < 1e-8;
  const points: GeoPoint[] = [];
  // Sample the full envelope, not only its six corner/edge points. A large
  // wordmark can cross a neighbouring polygon through its middle while all
  // six old probes remain outside it.
  for (const along of samples) {
    for (const across of samples) {
      if (followsLatitude) {
        const rowLatitude = Math.max(
          -Math.PI / 2 + 1e-5,
          Math.min(Math.PI / 2 - 1e-5, latitude + across * halfHeight),
        );
        const safeCosine = Math.max(
          Math.abs(Math.cos(rowLatitude)),
          POLE_SAFE_COSINE,
        );
        const longitudeOffset = Math.max(
          -POLE_SAFE_LONGITUDE_SPAN,
          Math.min(POLE_SAFE_LONGITUDE_SPAN, (along * halfWidth) / safeCosine),
        );
        points.push({
          latitude: (rowLatitude * 180) / Math.PI,
          longitude: normalizeLongitude(
            ((longitude + longitudeOffset) * 180) / Math.PI,
          ),
        });
        continue;
      }
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
/**
 * Slots are generated against Natural Earth 50m land. The phone-class 110m
 * globe omits many small island countries, so a wordmark there is drawn only
 * when its centre sits on that country's rendered land; otherwise it would
 * float over empty ocean. Such countries keep their side-panel record.
 */
export function isSurnameLabelSlotOnRenderedLand(
  slot: Pick<SurnameLabelSlot, 'center'>,
  countryId: string,
  vectorDetail: '110m' | '50m',
  renderedCountries: ReadonlyMap<string, CountryFeature>,
): boolean {
  if (vectorDetail === '50m') return true;
  const country = renderedCountries.get(countryId);
  return country
    ? geoContains(country, [slot.center.longitude, slot.center.latitude])
    : false;
}

export function chooseSurnameLabelSlot(
  countryId: string,
  anchor: { point: GeoPoint; clearanceDegrees: number },
  wordmark: SurnameWordmark,
  _countries: readonly CountryFeature[],
): SurnameLabelSlot | null {
  void _countries; // Retained for callers; layout never examines polygons.
  const candidatePool = getSurnameLabelCandidatePool(countryId, wordmark);
  return chooseLargestSurnameLabelSlot(candidatePool, anchor.point);
}

/** Chooses a bounded precomputed alternative after screen-space occlusion. */
export function chooseAlternativeSurnameLabelSlot(
  countryId: string,
  anchor: { point: GeoPoint; clearanceDegrees: number },
  wordmark: SurnameWordmark,
  _countries: readonly CountryFeature[],
  current: SurnameLabelSlot,
): SurnameLabelSlot | null {
  void _countries;
  const currentKey = surnameLabelSlotKey(current);
  return chooseLargestSurnameLabelSlot(
    getSurnameLabelCandidatePool(countryId, wordmark).filter(
      (candidate) => surnameLabelSlotKey(candidate) !== currentKey,
    ),
    anchor.point,
  );
}

function getSurnameLabelCandidatePool(
  countryId: string,
  wordmark: SurnameWordmark,
): readonly SurnameLabelSlot[] {
  const layouts = generatedWordmarks.layouts as Record<
    string,
    readonly (readonly number[])[]
  >;
  const candidates = GENERATED_SLOTS[countryId] ?? [];
  return (
    layouts[`${countryId}:${wordmark.layout}:${wordmark.value}`] ?? []
  ).flatMap(([index, radius]) => {
    if (index === undefined || radius === undefined) return [];
    const slot = candidates[index];
    return slot?.landSafe && slot.layout === wordmark.layout && radius > 0
      ? [{ ...slot, maxAngularDegrees: radius }]
      : [];
  });
}

// Horizontal is the cartographic default; a rotated slot must make this
// particular wordmark materially larger before it replaces the parallel.
const ROTATED_WORDMARK_GAIN = 1.15;

// A label belongs near its country's visual centre unless that costs a lot
// of size. Must equal CENTRALITY_WEIGHT in scripts/build-surname-label-slots.mjs,
// which generates centred candidates with the same score.
const CENTRALITY_WEIGHT = 0.4;

/**
 * Wordmark radius discounted by distance from the country's label anchor, as
 * a fraction of the country's scale. A slot at the anchor keeps its size; one
 * a whole country-scale away counts 40% smaller.
 */
export function scoreSurnameLabelSlot(
  slot: SurnameLabelSlot,
  anchor: GeoPoint | null,
): number {
  if (!anchor || !slot.countryScaleCap) return slot.maxAngularDegrees;
  const distanceDegrees =
    (geoDistance(
      [slot.center.longitude, slot.center.latitude],
      [anchor.longitude, anchor.latitude],
    ) *
      180) /
    Math.PI;
  return (
    slot.maxAngularDegrees *
    (1 -
      CENTRALITY_WEIGHT * Math.min(1, distanceDegrees / slot.countryScaleCap))
  );
}

function chooseLargestSurnameLabelSlot(
  candidatePool: readonly SurnameLabelSlot[],
  anchor: GeoPoint | null,
): SurnameLabelSlot | null {
  const largest = (slots: readonly SurnameLabelSlot[]) =>
    [...slots].sort(
      (a, b) =>
        scoreSurnameLabelSlot(b, anchor) - scoreSurnameLabelSlot(a, anchor) ||
        a.oceanDirection.localeCompare(b.oceanDirection),
    )[0] ?? null;
  const horizontal = largest(
    candidatePool.filter((slot) => Math.abs(slot.rotationDegrees) < 1e-6),
  );
  const rotated = largest(
    candidatePool.filter((slot) => Math.abs(slot.rotationDegrees) >= 1e-6),
  );
  if (!rotated) return horizontal;
  if (!horizontal) return rotated;
  return scoreSurnameLabelSlot(rotated, anchor) >=
    ROTATED_WORDMARK_GAIN * scoreSurnameLabelSlot(horizontal, anchor)
    ? rotated
    : horizontal;
}

function getStrictSlotRadius(
  slot: SurnameLabelSlot,
  wordmark?: SurnameWordmark,
): number {
  if (!wordmark) return slot.strictMaxAngularDegrees ?? slot.maxAngularDegrees;
  const heightRatio = getSurnameWordmarkHeightRatio(wordmark);
  if (heightRatio >= SQUARE_WORDMARK_HEIGHT_RATIO) {
    return (
      slot.strictSquareMax ??
      slot.strictMaxAngularDegrees ??
      slot.maxAngularDegrees
    );
  }
  if (heightRatio >= LONG_WORDMARK_HEIGHT_RATIO) {
    return (
      slot.strictMediumMax ??
      slot.strictMaxAngularDegrees ??
      slot.maxAngularDegrees
    );
  }
  return slot.strictMaxAngularDegrees ?? slot.maxAngularDegrees;
}

function surnameLabelSlotKey(slot: SurnameLabelSlot): string {
  return `${slot.layout}:${slot.rotationDegrees}:${slot.center.latitude.toFixed(5)}:${slot.center.longitude.toFixed(5)}`;
}

/**
 * Expands a candidate until its actual SVG envelope reaches neighbouring land.
 * The previous build used one conservative anchor clearance for every word;
 * that made wide countries render labels far below their available area. The
 * search is deterministic and bounded, for the offline compiler, while the
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
