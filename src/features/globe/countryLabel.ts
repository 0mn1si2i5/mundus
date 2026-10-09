import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import type { Feature, Geometry, Polygon } from 'geojson';
import type { CountryFeature } from './countryData';
import type { GeoPoint } from './geo';
import generatedAnchors from '../../data/generated/country-label-anchors.json' with { type: 'json' };

const RAD_TO_DEG = 180 / Math.PI;
const GRID_STEPS = 12;
const LABEL_SURFACE_RADIUS = 1.012;
const LABEL_HEIGHT_RATIO = 0.34;
const LABEL_CLEARANCE_SAFETY = 0.42;
const LABEL_MAX_WIDTH = 0.34;

export interface CountryLabelAnchor {
  point: GeoPoint;
  clearanceDegrees: number;
}

type GeneratedAnchor = CountryLabelAnchor;

const GENERATED_LABEL_ANCHORS = generatedAnchors.anchors as Record<
  string,
  GeneratedAnchor
>;

/**
 * Returns a conservative world-space width for the three-line billboard.
 * The diagonal, rather than only the width, is kept inside the measured
 * angular clearance so the billboard cannot cross a country boundary when it
 * faces the camera.
 */
export function getCountryLabelWorldWidth(clearanceDegrees: number): number {
  const clearanceRadians =
    Math.max(0, Math.min(clearanceDegrees, 35)) * (Math.PI / 180);
  const halfDiagonal =
    LABEL_SURFACE_RADIUS * Math.tan(clearanceRadians * LABEL_CLEARANCE_SAFETY);
  return Math.min(
    LABEL_MAX_WIDTH,
    (2 * halfDiagonal) / Math.sqrt(1 + LABEL_HEIGHT_RATIO ** 2),
  );
}

export function getCountryLabelAngularFootprintDegrees(width: number): number {
  const halfDiagonal =
    (Math.max(0, width) / 2) * Math.sqrt(1 + LABEL_HEIGHT_RATIO ** 2);
  return Math.atan2(halfDiagonal, LABEL_SURFACE_RADIUS) * RAD_TO_DEG;
}

export const COUNTRY_LABEL_HEIGHT_RATIO = LABEL_HEIGHT_RATIO;

// The 110m Mundus country topology omits these two small countries, while the
// 50m topology contains them. Keep verified interior points so a
// future country selection can still place a surname label without bundling a
// second GeoJSON dataset into the CPU picking path.
const FALLBACK_LABEL_ANCHORS: Readonly<Record<string, CountryLabelAnchor>> = {
  'ne-234': {
    point: { latitude: 62.05268, longitude: -6.88076 },
    clearanceDegrees: 0.35,
  },
  'ne-470': {
    point: { latitude: 35.92151, longitude: 14.40505 },
    clearanceDegrees: 0.35,
  },
};

export function getFallbackCountryLabelAnchor(
  countryId: string,
): CountryLabelAnchor | null {
  return (
    FALLBACK_LABEL_ANCHORS[countryId] ??
    GENERATED_LABEL_ANCHORS[countryId] ??
    null
  );
}

type PolygonCoordinates = Polygon['coordinates'];

/**
 * Finds a point with useful clearance from a country's border. A geographic
 * centroid is a good first candidate, but it may land in a neighbouring
 * country for concave or multi-part countries, so every candidate is checked.
 */
export function getCountryLabelAnchor(
  country: CountryFeature,
): CountryLabelAnchor | null {
  const generated = GENERATED_LABEL_ANCHORS[country.properties.countryId];
  if (
    generated &&
    geoContains(country, [generated.point.longitude, generated.point.latitude])
  ) {
    return generated;
  }

  return computeCountryLabelAnchor(country);
}

/**
 * Computes an anchor from the supplied geometry without consulting the
 * generated high-resolution anchor table. The build script uses this to
 * derive deterministic anchors from the pinned 50m and 110m assets.
 */
export function computeCountryLabelAnchor(
  country: CountryFeature,
): CountryLabelAnchor | null {
  const polygons = [...polygonGeometries(country.geometry)].sort(
    (a, b) => geoArea(b) - geoArea(a),
  );
  const candidates: Candidate[] = [];

  for (const polygon of polygons) {
    const polygonFeature = polygonFeatureFor(polygon);
    const polygonCandidates = [
      toPoint(geoCentroid(polygonFeature)),
      averageCoordinate(polygon.coordinates[0]),
      ...gridCandidates(polygon.coordinates[0]),
    ].filter((candidate): candidate is GeoPoint => candidate !== null);

    for (const point of uniquePoints(polygonCandidates)) {
      if (!geoContains(polygonFeature, [point.longitude, point.latitude])) {
        continue;
      }
      candidates.push({
        point,
        clearanceDegrees: boundaryClearance(point, polygon.coordinates),
      });
    }
  }

  const best = [...candidates].sort(
    (a, b) => b.clearanceDegrees - a.clearanceDegrees,
  )[0];
  if (best) return best;

  return null;
}

/** Returns the nearest sampled boundary distance for a point inside a country. */
export function getCountryLabelClearance(
  country: CountryFeature,
  point: GeoPoint,
): number {
  let best = 0;
  for (const polygon of polygonGeometries(country.geometry)) {
    const polygonFeature = polygonFeatureFor(polygon);
    if (!geoContains(polygonFeature, [point.longitude, point.latitude])) {
      continue;
    }
    best = Math.max(best, boundaryClearance(point, polygon.coordinates));
  }
  return best;
}

/** Returns a generated anchor for countries absent from the 110m picking set. */
export function getCountryLabelAnchorForId(
  countryId: string,
): CountryLabelAnchor | null {
  return (
    GENERATED_LABEL_ANCHORS[countryId] ??
    getFallbackCountryLabelAnchor(countryId)
  );
}

function polygonGeometries(geometry: Geometry): Polygon[] {
  if (geometry.type === 'Polygon') return [geometry];
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((coordinates) => ({
      type: 'Polygon',
      coordinates,
    }));
  }
  return [];
}

function polygonFeatureFor(
  geometry: Polygon,
): Feature<Polygon, Record<string, never>> {
  return { type: 'Feature', properties: {}, geometry };
}

function toPoint(value: [number, number]): GeoPoint | null {
  const [longitude, latitude] = value;
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude: normalizeLongitude(longitude) }
    : null;
}

function averageCoordinate(
  ring: PolygonCoordinates[number] | undefined,
): GeoPoint | null {
  if (!ring || ring.length === 0) return null;
  const sum = ring.reduce(
    (total, coordinate) => {
      total.longitude += coordinate[0] ?? 0;
      total.latitude += coordinate[1] ?? 0;
      return total;
    },
    { longitude: 0, latitude: 0 },
  );
  return toPoint([sum.longitude / ring.length, sum.latitude / ring.length]);
}

function gridCandidates(
  ring: PolygonCoordinates[number] | undefined,
): GeoPoint[] {
  if (!ring || ring.length === 0) return [];
  const reference = ring[0]?.[0] ?? 0;
  const longitudes = ring.map(([longitude]) =>
    unwrapLongitude(longitude ?? reference, reference),
  );
  const latitudes = ring.map(([, latitude]) => latitude ?? 0);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  if (![west, east, south, north].every(Number.isFinite)) return [];

  const candidates: GeoPoint[] = [];
  for (let y = 0; y <= GRID_STEPS; y += 1) {
    const latitude = south + ((north - south) * y) / GRID_STEPS;
    for (let x = 0; x <= GRID_STEPS; x += 1) {
      const longitude = west + ((east - west) * x) / GRID_STEPS;
      const point = toPoint([longitude, latitude]);
      if (point) candidates.push(point);
    }
  }
  return candidates;
}

function boundaryClearance(
  point: GeoPoint,
  coordinates: PolygonCoordinates,
): number {
  const target = unitVector(point.longitude, point.latitude);
  let minimum = Number.POSITIVE_INFINITY;
  for (const ring of coordinates) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      if (!start || !end) continue;
      minimum = Math.min(
        minimum,
        greatCircleSegmentDistance(
          target,
          unitVector(start[0] ?? 0, start[1] ?? 0),
          unitVector(end[0] ?? 0, end[1] ?? 0),
        ),
      );
    }
  }
  return Number.isFinite(minimum) ? minimum * RAD_TO_DEG : 0;
}

type Vector3 = readonly [number, number, number];

function unitVector(longitude: number, latitude: number): Vector3 {
  const lambda = longitude / RAD_TO_DEG;
  const phi = latitude / RAD_TO_DEG;
  return [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function angle(a: Vector3, b: Vector3): number {
  return Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
}

/**
 * Exact angular distance (radians) from a point to the minor great-circle
 * arc between two boundary vertices, matching d3-geo's spherical edges.
 */
function greatCircleSegmentDistance(
  point: Vector3,
  start: Vector3,
  end: Vector3,
): number {
  const endpoints = Math.min(angle(point, start), angle(point, end));
  const normal = cross(start, end);
  const length = Math.hypot(...normal);
  if (length < 1e-12) return endpoints;
  const unitNormal: Vector3 = [
    normal[0] / length,
    normal[1] / length,
    normal[2] / length,
  ];
  // The point's projection onto the great circle lies within the arc when
  // the point is between the planes through each endpoint and the normal.
  const inside =
    dot(cross(start, point), unitNormal) >= 0 &&
    dot(cross(point, end), unitNormal) >= 0;
  if (!inside) return endpoints;
  return Math.min(endpoints, Math.abs(Math.asin(dot(point, unitNormal))));
}

function uniquePoints(points: readonly GeoPoint[]): GeoPoint[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function unwrapLongitude(longitude: number, reference: number): number {
  let result = longitude;
  while (result - reference > 180) result -= 360;
  while (result - reference < -180) result += 360;
  return result;
}

interface Candidate {
  point: GeoPoint;
  clearanceDegrees: number;
}
