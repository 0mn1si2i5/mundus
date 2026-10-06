import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint32BufferAttribute,
  Vector3,
} from 'three';
import { geoToVector3 } from './geo';
import type { GeoPoint } from './geo';

export const SURNAME_LABEL_SURFACE_LIFT = 1.003;
export const SURNAME_LABEL_SURFACE_SEGMENTS = { along: 24, across: 6 } as const;
const POLE_SAFE_COSINE = 0.12;
const POLE_SAFE_LONGITUDE_SPAN = Math.PI * 0.75;

export interface SphericalSurnameLabelGeometryOptions {
  center: GeoPoint;
  angularRadiusDegrees: number;
  aspectRatio: number;
  rotationDegrees: number;
  surfaceLift?: number;
  segmentsAlong?: number;
  segmentsAcross?: number;
}

export interface SphericalSurnameLabelPoint {
  position: [number, number, number];
  uv: [number, number];
}

/**
 * Maps a transparent wordmark texture onto a tangent patch of the globe.
 * The patch is made from actual spherical vertices, so it stays attached to
 * the surface while the globe group rotates instead of behaving like a
 * billboard hovering above it.
 */
export function createSphericalSurnameLabelGeometry(
  options: SphericalSurnameLabelGeometryOptions,
): BufferGeometry {
  const points = createSphericalSurnameLabelPoints(options);
  const along = options.segmentsAlong ?? SURNAME_LABEL_SURFACE_SEGMENTS.along;
  const across =
    options.segmentsAcross ?? SURNAME_LABEL_SURFACE_SEGMENTS.across;
  const positions = new Float32Array(points.length * 3);
  const uvs = new Float32Array(points.length * 2);
  for (const [index, point] of points.entries()) {
    positions[index * 3] = point.position[0];
    positions[index * 3 + 1] = point.position[1];
    positions[index * 3 + 2] = point.position[2];
    uvs[index * 2] = point.uv[0];
    // TextureLoader uploads SVG rows with the source top at v=0. The
    // surface grid already runs from south to north, so preserve that
    // orientation instead of applying a second vertical flip.
    uvs[index * 2 + 1] = 1 - point.uv[1];
  }
  const indices: number[] = [];
  for (let row = 0; row < across; row += 1) {
    for (let column = 0; column < along; column += 1) {
      const lowerLeft = row * (along + 1) + column;
      const lowerRight = lowerLeft + 1;
      const upperLeft = lowerLeft + along + 1;
      const upperRight = upperLeft + 1;
      indices.push(
        lowerLeft,
        lowerRight,
        upperLeft,
        lowerRight,
        upperRight,
        upperLeft,
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createSphericalSurnameLabelPoints(
  options: SphericalSurnameLabelGeometryOptions,
): SphericalSurnameLabelPoint[] {
  const along = options.segmentsAlong ?? SURNAME_LABEL_SURFACE_SEGMENTS.along;
  const across =
    options.segmentsAcross ?? SURNAME_LABEL_SURFACE_SEGMENTS.across;
  const radius = Math.max(
    0.001,
    (Math.max(0, options.angularRadiusDegrees) * Math.PI) / 180,
  );
  const aspect = Math.max(0.05, options.aspectRatio);
  const halfWidth = radius / Math.sqrt(1 + aspect ** 2);
  const halfHeight = halfWidth * aspect;
  const angle = (options.rotationDegrees * Math.PI) / 180;
  const center = geoToVector3(options.center).normalize();
  const latitude = (options.center.latitude * Math.PI) / 180;
  const longitude = (options.center.longitude * Math.PI) / 180;
  const east = new Vector3(
    Math.cos(longitude),
    0,
    -Math.sin(longitude),
  ).normalize();
  const north = new Vector3(
    -Math.sin(latitude) * Math.sin(longitude),
    Math.cos(latitude),
    -Math.sin(latitude) * Math.cos(longitude),
  ).normalize();
  const rotatedEast = east
    .clone()
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(north, Math.sin(angle));
  const rotatedNorth = north
    .clone()
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(east, -Math.sin(angle));
  const surfaceLift = options.surfaceLift ?? SURNAME_LABEL_SURFACE_LIFT;
  const followsLatitude = Math.abs(options.rotationDegrees) < 1e-8;
  const points: SphericalSurnameLabelPoint[] = [];
  for (let row = 0; row <= across; row += 1) {
    const v = row / across;
    const y = (v * 2 - 1) * halfHeight;
    // A zero-rotation wordmark is deliberately parameterized in geographic
    // coordinates. Every row then has one exact latitude and its baseline
    // advances east-west along that parallel, rather than approximating the
    // parallel with a tangent-plane chord.
    const rowLatitude = Math.max(
      -Math.PI / 2 + 1e-5,
      Math.min(Math.PI / 2 - 1e-5, latitude + y),
    );
    const rowCosine = Math.cos(rowLatitude);
    for (let column = 0; column <= along; column += 1) {
      const u = column / along;
      const x = (u * 2 - 1) * halfWidth;
      let surface: Vector3;
      if (followsLatitude) {
        // Longitude is undefined at a pole. Keep the row finite and bounded
        // there while preserving the exact row latitude and a stable seam.
        const safeCosine = Math.max(Math.abs(rowCosine), POLE_SAFE_COSINE);
        const longitudeOffset = Math.max(
          -POLE_SAFE_LONGITUDE_SPAN,
          Math.min(POLE_SAFE_LONGITUDE_SPAN, x / safeCosine),
        );
        surface = geoToVector3({
          latitude: (rowLatitude * 180) / Math.PI,
          longitude: ((longitude + longitudeOffset) * 180) / Math.PI,
        });
      } else {
        const tangent = rotatedEast
          .clone()
          .multiplyScalar(x)
          .addScaledVector(rotatedNorth, y);
        const tangentLength = tangent.length();
        surface =
          tangentLength < 1e-8
            ? center.clone()
            : center
                .clone()
                .multiplyScalar(Math.cos(tangentLength))
                .addScaledVector(tangent.normalize(), Math.sin(tangentLength));
      }
      const position = surface.multiplyScalar(surfaceLift);
      points.push({
        position: [position.x, position.y, position.z],
        uv: [u, 1 - v],
      });
    }
  }
  return points;
}

export function getSphericalLabelBounds(geometry: BufferGeometry): {
  min: [number, number];
  max: [number, number];
  vertexCount: number;
} {
  const position = geometry.getAttribute('position');
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    minX = Math.min(minX, position.getX(index));
    minY = Math.min(minY, position.getY(index));
    maxX = Math.max(maxX, position.getX(index));
    maxY = Math.max(maxY, position.getY(index));
  }
  return { min: [minX, minY], max: [maxX, maxY], vertexCount: position.count };
}
