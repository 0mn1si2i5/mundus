import { Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { geoEquirectangular, geoPath } from 'd3-geo';
import type { Geometry, Position } from 'geojson';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three';
import { useAppStore } from '../../state/appStore';
import {
  TRUE_SIZE_DEFAULT_COUNTRY,
  placeTrueSizeCountry,
} from '../truesize/trueSize';
import { geoToVector3 } from './geo';
import { Marker } from './Marker';
import type { QualityProfile } from './quality';
import { ignoreRaycast } from './sceneUtils';

export const TRUE_SIZE_RENDERING = {
  fill: { color: '#c98755', alpha: 0.5, radius: 1.004, renderOrder: 4 },
  outline: { color: '#9b3f2d', radius: 1.008, width: 1.6, renderOrder: 5 },
  home: { color: '#5f584e', radius: 1.006, width: 1, opacity: 0.55 },
} as const;

function ringSegments(rings: readonly Position[][], radius: number): Vector3[] {
  const points: Vector3[] = [];
  for (const ring of rings) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [fromLon, fromLat] = ring[index]!;
      const [toLon, toLat] = ring[index + 1]!;
      points.push(
        geoToVector3({ latitude: fromLat!, longitude: fromLon! }, radius),
        geoToVector3({ latitude: toLat!, longitude: toLon! }, radius),
      );
    }
  }
  return points;
}

function createFillTexture(width: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = width / 2;
  const context = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.offset.x = 0.25;
  const path = context
    ? geoPath(
        geoEquirectangular()
          .fitSize([canvas.width, canvas.height], { type: 'Sphere' })
          .precision(0.2),
        context,
      )
    : null;
  return {
    texture,
    draw(geometry: Geometry | null) {
      if (!context || !path) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (geometry) {
        context.globalAlpha = TRUE_SIZE_RENDERING.fill.alpha;
        context.fillStyle = TRUE_SIZE_RENDERING.fill.color;
        context.beginPath();
        path(geometry);
        context.fill();
        context.globalAlpha = 1;
      }
      texture.needsUpdate = true;
    },
  };
}

/**
 * The carried country: a translucent fill drawn into an equirectangular
 * texture (d3 handles antimeridian and pole cutting), a crisp outline, and a
 * faint outline at home.
 */
export default function TrueSizeLayer({
  profile,
}: {
  profile: QualityProfile;
}) {
  const point = useAppStore((state) => state.point);
  const countryId = useAppStore(
    (state) => state.trueSizeCountry ?? TRUE_SIZE_DEFAULT_COUNTRY,
  );
  const invalidate = useThree((state) => state.invalidate);
  const placement = useMemo(
    () => placeTrueSizeCountry(countryId, point),
    [countryId, point],
  );

  const fill = useMemo(
    () => createFillTexture(profile.textureWidth),
    [profile.textureWidth],
  );
  useEffect(() => () => fill.texture.dispose(), [fill]);
  useEffect(() => {
    fill.draw(placement?.placed.geometry ?? null);
    invalidate();
  }, [fill, invalidate, placement]);

  const outline = useMemo(
    () =>
      placement
        ? ringSegments(
            placement.placed.rings,
            TRUE_SIZE_RENDERING.outline.radius,
          )
        : [],
    [placement],
  );
  const home = useMemo(
    () =>
      placement
        ? ringSegments(placement.homeRings, TRUE_SIZE_RENDERING.home.radius)
        : [],
    [placement],
  );
  const markerPosition = useMemo(() => geoToVector3(point, 1.012), [point]);

  return (
    <>
      <mesh
        scale={TRUE_SIZE_RENDERING.fill.radius}
        renderOrder={TRUE_SIZE_RENDERING.fill.renderOrder}
        raycast={ignoreRaycast}
      >
        <sphereGeometry args={[1, ...profile.sphereSegments]} />
        <meshBasicMaterial
          map={fill.texture}
          transparent
          depthTest
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {home.length > 1 ? (
        <Line
          points={home}
          segments
          color={TRUE_SIZE_RENDERING.home.color}
          lineWidth={TRUE_SIZE_RENDERING.home.width}
          dashed
          dashSize={0.012}
          gapSize={0.008}
          transparent
          opacity={TRUE_SIZE_RENDERING.home.opacity}
          depthWrite={false}
          raycast={ignoreRaycast}
        />
      ) : null}
      {outline.length > 1 ? (
        <Line
          points={outline}
          segments
          color={TRUE_SIZE_RENDERING.outline.color}
          lineWidth={TRUE_SIZE_RENDERING.outline.width}
          depthWrite={false}
          renderOrder={TRUE_SIZE_RENDERING.outline.renderOrder}
          raycast={ignoreRaycast}
        />
      ) : null}
      <Marker
        position={markerPosition}
        color={TRUE_SIZE_RENDERING.outline.color}
        centerColor="#fbf8ef"
        role="selected"
      />
    </>
  );
}
