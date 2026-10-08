import { sampleShortGeodesic } from '../antipodes/relation';
import { normalizeLongitude, type GeoPoint } from '../antipodes/geography';

interface UnitVector {
  x: number;
  y: number;
  z: number;
}

function vector(point: GeoPoint): UnitVector {
  const latitude = (point.latitude * Math.PI) / 180;
  const longitude = (point.longitude * Math.PI) / 180;
  const radius = Math.cos(latitude);
  return {
    x: radius * Math.sin(longitude),
    y: Math.sin(latitude),
    z: radius * Math.cos(longitude),
  };
}

function point(value: UnitVector): GeoPoint {
  return {
    latitude:
      (Math.atan2(value.y, Math.hypot(value.x, value.z)) * 180) / Math.PI,
    longitude: normalizeLongitude(
      (Math.atan2(value.x, value.z) * 180) / Math.PI,
    ),
  };
}

function cross(a: UnitVector, b: UnitVector): UnitVector {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(value: UnitVector): UnitVector {
  const length = Math.hypot(value.x, value.y, value.z);
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

export function smallCirclePoints(
  center: GeoPoint,
  angularRadiusRad: number,
  segments = 128,
): GeoPoint[] {
  const count = Math.max(3, Math.floor(segments));
  const centre = vector(center);
  const reference =
    Math.abs(centre.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const first = normalize(cross(reference, centre));
  const second = normalize(cross(centre, first));
  const sinRadius = Math.sin(angularRadiusRad);
  const cosRadius = Math.cos(angularRadiusRad);
  const points = Array.from({ length: count + 1 }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    return point({
      x:
        centre.x * cosRadius +
        sinRadius * (first.x * Math.cos(angle) + second.x * Math.sin(angle)),
      y:
        centre.y * cosRadius +
        sinRadius * (first.y * Math.cos(angle) + second.y * Math.sin(angle)),
      z:
        centre.z * cosRadius +
        sinRadius * (first.z * Math.cos(angle) + second.z * Math.sin(angle)),
    });
  });
  points[points.length - 1] = { ...points[0]! };
  return points;
}

export function greatCircleArcPoints(
  a: GeoPoint,
  b: GeoPoint,
  segments = 64,
): GeoPoint[] {
  return sampleShortGeodesic(a, b, segments);
}
