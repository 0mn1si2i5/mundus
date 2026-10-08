import { Billboard, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  type Group,
  type PerspectiveCamera,
} from 'three';
import type { IsolationGlobePresentation } from '../modes/useModePresentation';
import {
  greatCircleArcPoints,
  smallCirclePoints,
} from '../isolation/isolationGeometry';
import { geoToVector3 } from './geo';
import { ignoreRaycast } from './sceneUtils';
import { cssPixelsToWorldUnits } from './screenSpace';
import { EARTH_RADIUS_KM } from '../isolation/isolationMetric';

export function IsolationLayer({
  isolation,
}: {
  isolation: IsolationGlobePresentation;
}) {
  const focalPositions = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        isolation.focalPoints.flatMap((point) => {
          const vector = geoToVector3(point, 1.008);
          return [vector.x, vector.y, vector.z];
        }),
        3,
      ),
    );
    return geometry;
  }, [isolation.focalPoints]);
  useEffect(() => () => focalPositions.dispose(), [focalPositions]);
  const ring = useMemo(
    () =>
      isolation.radiusKm === null
        ? []
        : smallCirclePoints(
            isolation.city,
            isolation.radiusKm / EARTH_RADIUS_KM,
          ),
    [isolation.city, isolation.radiusKm],
  );
  const arc = useMemo(
    () =>
      isolation.competitor
        ? greatCircleArcPoints(isolation.city, isolation.competitor)
        : [],
    [isolation.city, isolation.competitor],
  );
  return (
    <>
      <points geometry={focalPositions} raycast={ignoreRaycast}>
        <pointsMaterial
          color="#8a7a60"
          size={3}
          sizeAttenuation={false}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </points>
      <IsolationMarker point={isolation.city} color="#b88746" />
      {isolation.competitor ? (
        <IsolationMarker point={isolation.competitor} color="#79bba9" />
      ) : null}
      {ring.length > 1 ? (
        <Line
          points={ring.map((point) => geoToVector3(point, 1.012))}
          color="#b88746"
          lineWidth={1.2}
          transparent
          opacity={0.7}
          depthWrite={false}
          raycast={ignoreRaycast}
        />
      ) : null}
      {arc.length > 1 ? (
        <Line
          points={arc.map((point) => geoToVector3(point, 1.016))}
          color="#79bba9"
          lineWidth={1.15}
          transparent
          opacity={0.9}
          depthWrite={false}
          raycast={ignoreRaycast}
        />
      ) : null}
    </>
  );
}

function IsolationMarker({
  point,
  color,
}: {
  point: { latitude: number; longitude: number };
  color: string;
}) {
  const marker = useRef<Group>(null);
  const worldPosition = useMemo(() => new Vector3(), []);
  const direction = useMemo(() => new Vector3(), []);
  const offset = useMemo(() => new Vector3(), []);
  const { camera, size } = useThree();
  useFrame(() => {
    const group = marker.current;
    if (!group) return;
    group.getWorldPosition(worldPosition);
    camera.getWorldDirection(direction);
    const distance = offset
      .subVectors(worldPosition, camera.position)
      .dot(direction);
    group.scale.setScalar(
      cssPixelsToWorldUnits(
        7,
        distance,
        (camera as PerspectiveCamera).fov,
        size.height,
      ),
    );
  });
  return (
    <group ref={marker} position={geoToVector3(point, 1.022)} renderOrder={6}>
      <Billboard>
        <mesh raycast={ignoreRaycast} renderOrder={6}>
          <circleGeometry args={[0.5, 24]} />
          <meshBasicMaterial
            color={color}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
    </group>
  );
}
