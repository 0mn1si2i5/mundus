import type { GeoPoint } from '../globe/geo';
import type { InverseField } from './inverseFormat.mjs';
import {
  sampleInverseDisplacement,
  sampleInverseLatitude,
  morphLatitude,
} from './inverseSampling.mjs';

export const MORPH_DURATION_MS = 1600;
export function wrapLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

/** Shared build/runtime sampling contract, also implemented by the shader. */
export function sampleDisplacement(
  field: InverseField | null,
  longitude: number,
  s: number,
): [number, number] {
  return sampleInverseDisplacement(
    field,
    (wrapLongitude(longitude) + 180) / 360,
    (s + 1) / 2,
  );
}

export interface MorphMapping {
  from: InverseField | null;
  to: InverseField | null;
  t: number;
}
export function inversePoint(point: GeoPoint, mapping: MorphMapping): GeoPoint {
  const x = (wrapLongitude(point.longitude) + 180) / 360;
  const a = sampleInverseLatitude(mapping.from, x, point.latitude),
    b = sampleInverseLatitude(mapping.to, x, point.latitude);
  return {
    longitude: wrapLongitude(
      (a[0] + (wrapLongitude((b[0] - a[0]) * 360) / 360) * mapping.t) * 360 -
        180,
    ),
    latitude: morphLatitude(a[1], b[1], mapping.t),
  };
}

const forwardSeeds = new WeakMap<
  MorphMapping,
  {
    point: GeoPoint;
    display: GeoPoint;
    from: InverseField | null;
    to: InverseField | null;
    t: number;
  }
>();

/** A few selected points use damped Newton; no globe-sized CPU mesh. */
export function forwardPoint(point: GeoPoint, mapping: MorphMapping): GeoPoint {
  const finalInverse = (x: number, y: number) =>
    inversePoint({ longitude: x, latitude: y }, mapping);
  const longitudeWeight = Math.max(
    0.001,
    Math.cos((point.latitude * Math.PI) / 180),
  );
  const residual = (at: GeoPoint) => {
    const ex = wrapLongitude(at.longitude - point.longitude),
      ey = at.latitude - point.latitude;
    return { ex, ey, norm: ex * ex * longitudeWeight ** 2 + ey * ey };
  };
  const solve = (seed: GeoPoint, amount: number) => {
    let { longitude, latitude } = seed;
    const evaluate = (x: number, y: number) => {
      const final = finalInverse(x, y);
      return {
        longitude: x + wrapLongitude(final.longitude - x) * amount,
        latitude: morphLatitude(y, final.latitude, amount),
      };
    };
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const at = evaluate(longitude, latitude),
        { ex, ey, norm } = residual(at);
      if (Math.abs(ex) < 1e-7 && Math.abs(ey) < 1e-7) break;
      const hx = 0.001,
        hy = latitude > 89.999 ? -0.0001 : 0.0001,
        px = evaluate(longitude + hx, latitude),
        nextLatitude = clamp(latitude + hy, -90, 90),
        py = evaluate(longitude, nextLatitude),
        actualHy = nextLatitude - latitude;
      if (actualHy === 0) break;
      const a = wrapLongitude(px.longitude - at.longitude) / hx,
        b = wrapLongitude(py.longitude - at.longitude) / actualHy,
        c = (px.latitude - at.latitude) / hx,
        d = (py.latitude - at.latitude) / actualHy;
      const determinant = a * d - b * c;
      if (Math.abs(determinant) < 1e-10) break;
      const dx = clamp((d * ex - b * ey) / determinant, -30, 30),
        dy = clamp((-c * ex + a * ey) / determinant, -20, 20);
      let accepted = false;
      for (let scale = 1; scale >= 1 / 4096; scale /= 2) {
        const nextLongitude = longitude - dx * scale,
          nextLatitude = clamp(latitude - dy * scale, -90, 90);
        if (residual(evaluate(nextLongitude, nextLatitude)).norm < norm) {
          longitude = nextLongitude;
          latitude = nextLatitude;
          accepted = true;
          break;
        }
      }
      if (!accepted) break;
    }
    return { longitude: wrapLongitude(longitude), latitude };
  };
  const previous = forwardSeeds.get(mapping);
  const samePoint =
    previous?.point.latitude === point.latitude &&
    previous.point.longitude === point.longitude &&
    previous.from === mapping.from &&
    previous.to === mapping.to;
  if (samePoint && previous.t === mapping.t) return previous.display;
  const remember = (display: GeoPoint) => {
    forwardSeeds.set(mapping, {
      point,
      display,
      from: mapping.from,
      to: mapping.to,
      t: mapping.t,
    });
    return display;
  };
  const direct = solve(samePoint ? previous.display : point, 1);
  if (residual(finalInverse(direct.longitude, direct.latitude)).norm < 1e-10)
    return remember(direct);
  // A continuation from the identity supplies a nearby seed across compressed
  // regions where a single Newton solve can settle on the wrong local slope.
  let continued = point;
  for (let stage = 1; stage <= 16; stage += 1)
    continued = solve(continued, stage / 16);
  let best =
    residual(finalInverse(continued.longitude, continued.latitude)).norm <
    residual(finalInverse(direct.longitude, direct.latitude)).norm
      ? continued
      : direct;
  let bestNorm = residual(finalInverse(best.longitude, best.latitude)).norm;
  // A strongly compressed field can make the local finite-difference Jacobian
  // point at a neighbouring branch. Try a small deterministic neighbourhood
  // only after the normal continuation failed; selected markers are rare and
  // this keeps the common path unchanged.
  if (bestNorm > 1e-10) {
    for (const longitudeOffset of [-30, -15, 15, 30])
      for (const latitudeOffset of [-20, -10, 10, 20]) {
        const candidate = solve(
          {
            longitude: wrapLongitude(point.longitude + longitudeOffset),
            latitude: clamp(point.latitude + latitudeOffset, -90, 90),
          },
          1,
        );
        const norm = residual(
          finalInverse(candidate.longitude, candidate.latitude),
        ).norm;
        if (norm < bestNorm) {
          best = candidate;
          bestNorm = norm;
          if (bestNorm < 1e-10) return remember(best);
        }
      }
  }
  return remember(best);
}
