import { Billboard, Line } from '@react-three/drei';
import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { IsolationGlobePresentation } from '../modes/useModePresentation';
import {
  greatCircleArcPoints,
  smallCirclePoints,
} from '../isolation/isolationGeometry';
import { geoToVector3 } from './geo';
import { ignoreRaycast } from './sceneUtils';

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
  const ring = useMemo(
    () =>
      isolation.radiusKm === null
        ? []
        : smallCirclePoints(isolation.city, isolation.radiusKm / 6371.0088),
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
  return (
    <group position={geoToVector3(point, 1.022)} renderOrder={6}>
      <Billboard>
        <mesh raycast={ignoreRaycast} renderOrder={6}>
          <circleGeometry args={[0.055, 24]} />
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
