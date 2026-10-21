import {
  geoArea,
  geoCentroid,
  geoDistance,
  geoInterpolate,
  geoMercator,
  geoPath,
} from 'd3-geo';
import type { Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import type { GeoPoint } from '../antipodes/geography';
import { normalizeLongitude } from '../antipodes/geography';
import { EARTH_RADIUS_KM } from '../isolation/isolationMetric';

export const TRUE_SIZE_DEFAULT_COUNTRY = 'ne-304';

type Vec3 = readonly [number, number, number];
type Rotation = readonly [Vec3, Vec3, Vec3];

const DEG = Math.PI / 180;

function toVector([longitude, latitude]: Position): Vec3 {
  const lambda = longitude! * DEG;
  const phi = latitude! * DEG;
  return [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
}

function toPosition([x, y, z]: Vec3): Position {
  return [
    normalizeLongitude(Math.atan2(y, x) / DEG),
    Math.asin(Math.max(-1, Math.min(1, z))) / DEG,
  ];
}

function multiply(m: Rotation, [x, y, z]: Vec3): Vec3 {
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z,
    m[1][0] * x + m[1][1] * y + m[1][2] * z,
    m[2][0] * x + m[2][1] * y + m[2][2] * z,
  ];
}

function compose(a: Rotation, b: Rotation): Rotation {
  const column = (j: number): Vec3 =>
    multiply(a, [b[0][j]!, b[1][j]!, b[2][j]!]);
  const c0 = column(0);
  const c1 = column(1);
  const c2 = column(2);
  return [
    [c0[0], c1[0], c2[0]],
    [c0[1], c1[1], c2[1]],
    [c0[2], c1[2], c2[2]],
  ];
}

/** Rodrigues rotation about a unit axis. */
function axisRotation([x, y, z]: Vec3, angle: number): Rotation {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/**
 * North-preserving move: shift longitude about the polar axis, then slide
 * along the target meridian. Rotations keep shape and area exactly.
 */
export function trueSizeRotation(
  anchor: GeoPoint,
  target: GeoPoint,
): (position: Position) => Position {
  const spin = axisRotation(
    [0, 0, 1],
    (target.longitude - anchor.longitude) * DEG,
  );
  const lambda = target.longitude * DEG;
  // Rotating about this axis by +θ raises latitude along the target meridian.
  const westAxis: Vec3 = [Math.sin(lambda), -Math.cos(lambda), 0];
  const slide = axisRotation(
    westAxis,
    (target.latitude - anchor.latitude) * DEG,
  );
  const rotation = compose(slide, spin);
  return (position) => toPosition(multiply(rotation, toVector(position)));
}

function polygonsOf(geometry: Geometry): Position[][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** Centroid of the largest part, so the main landmass sits on the point. */
export function trueSizeAnchor(geometry: Geometry): GeoPoint {
  let best: Polygon | null = null;
  let bestArea = -1;
  for (const coordinates of polygonsOf(geometry)) {
    const polygon: Polygon = { type: 'Polygon', coordinates };
    const area = geoArea(polygon);
    if (area > bestArea) {
      best = polygon;
      bestArea = area;
    }
  }
  const [longitude, latitude] = geoCentroid(best ?? geometry);
  return { latitude, longitude };
}

/** Splits long edges so straight segments stay on the sphere. */
function densify(ring: Position[], maxStepDegrees: number): Position[] {
  const result: Position[] = [];
  for (let index = 0; index < ring.length - 1; index += 1) {
    const from = ring[index]!;
    const to = ring[index + 1]!;
    result.push(from);
    const a = from as [number, number];
    const b = to as [number, number];
    const interpolate = geoInterpolate(a, b);
    const steps = Math.ceil(geoDistance(a, b) / DEG / maxStepDegrees);
    for (let step = 1; step < steps; step += 1)
      result.push(interpolate(step / steps));
  }
  if (ring.length > 0) result.push(ring[ring.length - 1]!);
  return result;
}

export interface PlacedCountry {
  /** Rotated geometry; edges remain great-circle arcs. */
  geometry: MultiPolygon;
  /** Outline rings in [longitude, latitude], densified for line drawing. */
  rings: Position[][];
}

export function placeGeometry(
  geometry: Geometry,
  anchor: GeoPoint,
  target: GeoPoint,
): PlacedCountry {
  const rotate = trueSizeRotation(anchor, target);
  const coordinates = polygonsOf(geometry).map((polygon) =>
    polygon.map((ring) => ring.map(rotate)),
  );
  return {
    geometry: { type: 'MultiPolygon', coordinates },
    rings: coordinates.flatMap((polygon) =>
      polygon.map((ring) => densify(ring, 1)),
    ),
  };
}

export function outlineRings(geometry: Geometry): Position[][] {
  return polygonsOf(geometry).flatMap((polygon) =>
    polygon.map((ring) => densify(ring, 1)),
  );
}

export function areaKm2(geometry: Geometry): number {
  return geoArea(geometry) * EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

const mercatorPath = geoPath(geoMercator().scale(1).translate([0, 0]));

/**
 * How many times larger the shape looks on a Web Mercator map (clipped at
 * about 85.05°) than its true area. `null` when no part is on the map.
 */
export function mercatorInflation(geometry: Geometry): number | null {
  const trueArea = geoArea(geometry);
  const mapArea = mercatorPath.area(geometry);
  if (!(trueArea > 0) || !(mapArea > 0)) return null;
  return mapArea / trueArea;
}
