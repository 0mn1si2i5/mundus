import type { GeoPoint } from '../globe/geo';
import type { InverseField } from './inverseFormat.mjs';
import {
  sampleInverseDisplacement,
  sampleInverseLatitude,
  morphLatitude,
  ADAPTIVE_LEAF_MASK,
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

function* adaptiveLeaves(field: InverseField) {
  if (field.encoding !== 'adaptive-quadtree-int16') return;
  for (let y = 0; y < field.height; y += 1)
    for (let x = 0; x < field.width; x += 1) {
      const stack = [[y * field.width + x, x, y, 1]];
      while (stack.length) {
        const [node, ix, iy, size] = stack.pop()!;
        const word = field.tree[node!]!;
        if ((word & 0x80000000) !== 0) {
          yield [node!, ix!, iy!, size!] as const;
          continue;
        }
        for (let q = 3; q >= 0; q -= 1)
          stack.push([
            word + q,
            ix! + ((q % 2) * size!) / 2,
            iy! + (Math.floor(q / 2) * size!) / 2,
            size! / 2,
          ]);
      }
    }
}

/** Search existing encoded leaf corners only when local Newton needs a seed. */
function adaptiveSeeds(point: GeoPoint, field: InverseField): GeoPoint[] {
  if (
    field.encoding !== 'adaptive-quadtree-int16' ||
    field.header.verticalCoordinate !== 'latitude'
  )
    return [];
  const candidates: GeoPoint[] = [];
  for (const [node, ix, iy, size] of adaptiveLeaves(field)) {
    const at = (field.tree[node]! & ADAPTIVE_LEAF_MASK) * 8;
    const base = field.corners[at]! * field.header.stepLongitude;
    const longitude = (ix! / field.width) * 360 - 180;
    const latitude = (iy! / field.height) * 180 - 90;
    const dx = (size! / field.width) * 360,
      dy = (size! / field.height) * 180;
    const xs: number[] = [],
      ys: number[] = [];
    for (let q = 0; q < 4; q += 1) {
      xs.push(
        longitude +
          (q % 2) * dx +
          base +
          wrapLongitude(
            field.corners[at + q * 2]! * field.header.stepLongitude - base,
          ),
      );
      ys.push(
        latitude +
          Math.floor(q / 2) * dy +
          field.corners[at + q * 2 + 1]! * field.header.stepLatitude!,
      );
    }
    const targetX = xs[0]! + wrapLongitude(point.longitude - xs[0]!);
    if (
      targetX < Math.min(...xs) - 1e-7 ||
      targetX > Math.max(...xs) + 1e-7 ||
      point.latitude < Math.min(...ys) - 1e-7 ||
      point.latitude > Math.max(...ys) + 1e-7
    )
      continue;
    let u = 0.5,
      v = 0.5;
    const bx = xs[1]! - xs[0]!,
      cx = xs[2]! - xs[0]!,
      ddx = xs[3]! - xs[2]! - xs[1]! + xs[0]!;
    const by = ys[1]! - ys[0]!,
      cy = ys[2]! - ys[0]!,
      ddy = ys[3]! - ys[2]! - ys[1]! + ys[0]!;
    for (let n = 0; n < 12; n += 1) {
      const ex = xs[0]! + bx * u + cx * v + ddx * u * v - targetX,
        ey = ys[0]! + by * u + cy * v + ddy * u * v - point.latitude;
      const a = bx + ddx * v,
        b = cx + ddx * u,
        c = by + ddy * v,
        d = cy + ddy * u,
        determinant = a * d - b * c;
      if (Math.abs(determinant) < 1e-14) break;
      u -= (d * ex - b * ey) / determinant;
      v -= (-c * ex + a * ey) / determinant;
    }
    if (u >= -1e-7 && u <= 1 + 1e-7 && v >= -1e-7 && v <= 1 + 1e-7)
      candidates.push({
        longitude: longitude + u * dx,
        latitude: latitude + v * dy,
      });
  }
  return candidates;
}

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
  const finalField =
    mapping.t === 1 ? mapping.to : mapping.t === 0 ? mapping.from : null;
  if (finalField)
    for (const seed of adaptiveSeeds(point, finalField)) {
      const seeded = solve(seed, 1);
      if (
        residual(finalInverse(seeded.longitude, seeded.latitude)).norm < 1e-10
      )
        return remember(seeded);
    }
  // A continuation from the identity supplies a nearby seed across compressed
  // regions where a single Newton solve can settle on the wrong local slope.
  let continued = point;
  for (let stage = 1; stage <= 16; stage += 1)
    continued = solve(continued, stage / 16);
  return residual(finalInverse(continued.longitude, continued.latitude)).norm <
    residual(finalInverse(direct.longitude, direct.latitude)).norm
    ? remember(continued)
    : remember(direct);
}
