import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { Group, PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { GeoPoint } from './geo';
import { ignoreRaycast } from './sceneUtils';
import { cssPixelsToWorldUnits } from './screenSpace';
import type { MarkerDiagnosticReason } from './viewportDiagnostics';

type MarkerRole = 'origin' | 'antipode' | 'selected';

export interface MarkerDiagnosticHandle {
  request: (reason: MarkerDiagnosticReason) => void;
}

const MARKER_TARGET_CSS_PX = 11;
const MARKER_CENTER_RATIO = 3 / MARKER_TARGET_CSS_PX;

export function Marker({
  position,
  color,
  centerColor,
  role,
  point,
  diagnosticHandle,
  onDiagnostic,
  targetCssPixels = MARKER_TARGET_CSS_PX,
  renderOrder = 5,
  depthTest = true,
  depthWrite = false,
}: {
  position: Vector3;
  color: string;
  centerColor: string;
  role: MarkerRole;
  point?: GeoPoint;
  diagnosticHandle?: Ref<MarkerDiagnosticHandle>;
  onDiagnostic?: (
    globeCameraDistance: number,
    actualCssDiameter: number,
    latitude: number,
    longitude: number,
    reason: MarkerDiagnosticReason,
  ) => void;
  targetCssPixels?: number;
  renderOrder?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
}) {
  const marker = useRef<Group>(null);
  const worldPosition = useRef(new Vector3());
  const cameraDirection = useRef(new Vector3());
  const cameraOffset = useRef(new Vector3());
  const cameraRight = useRef(new Vector3());
  const projectedCenter = useRef(new Vector3());
  const projectedRadius = useRef(new Vector3());
  const diagnosticPending = useRef<MarkerDiagnosticReason | null>(null);
  const { camera, size, invalidate } = useThree();
  const diagnosticSize = useRef(`${size.width}x${size.height}`);

  useImperativeHandle(diagnosticHandle, () => ({
    request(reason) {
      diagnosticPending.current = reason;
    },
  }));

  useEffect(() => {
    if (!diagnosticHandle) return;
    const nextSize = `${size.width}x${size.height}`;
    if (diagnosticSize.current === nextSize) return;
    diagnosticSize.current = nextSize;
    diagnosticPending.current = 'resize';
    invalidate();
  }, [diagnosticHandle, invalidate, size.height, size.width]);

  useFrame(() => {
    const group = marker.current;
    if (!group) return;
    group.getWorldPosition(worldPosition.current);
    camera.getWorldDirection(cameraDirection.current);
    cameraOffset.current.subVectors(worldPosition.current, camera.position);
    const projectionDepth = cameraOffset.current.dot(cameraDirection.current);
    const verticalFov = (camera as PerspectiveCamera).fov;
    const diameter = cssPixelsToWorldUnits(
      targetCssPixels,
      projectionDepth,
      verticalFov,
      size.height,
    );
    group.scale.setScalar(diameter);
    if (diagnosticPending.current) {
      if (!point) return;
      cameraRight.current.setFromMatrixColumn(camera.matrixWorld, 0);
      projectedCenter.current.copy(worldPosition.current).project(camera);
      projectedRadius.current
        .copy(worldPosition.current)
        .addScaledVector(cameraRight.current, diameter / 2)
        .project(camera);
      const actualCssDiameter = Math.hypot(
        (projectedRadius.current.x - projectedCenter.current.x) * size.width,
        (projectedRadius.current.y - projectedCenter.current.y) * size.height,
      );
      const reason = diagnosticPending.current;
      diagnosticPending.current = null;
      onDiagnostic?.(
        camera.position.length(),
        actualCssDiameter,
        point.latitude,
        point.longitude,
        reason,
      );
    }
  });

  return (
    <group
      ref={marker}
      position={[position.x, position.y, position.z]}
      renderOrder={renderOrder}
    >
      <Billboard>
        <mesh raycast={ignoreRaycast} renderOrder={renderOrder}>
          <circleGeometry args={[MARKER_CENTER_RATIO / 2, 24]} />
          <meshBasicMaterial
            color={centerColor}
            depthTest={depthTest}
            depthWrite={depthWrite}
          />
        </mesh>
        <mesh raycast={ignoreRaycast} renderOrder={renderOrder}>
          <ringGeometry args={[0.39, 0.5, role === 'antipode' ? 4 : 32]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.95}
            side={2}
            depthTest={depthTest}
            depthWrite={depthWrite}
          />
        </mesh>
        {role === 'origin' ? (
          <>
            <mesh
              position={[0.32, 0, 0]}
              raycast={ignoreRaycast}
              renderOrder={renderOrder}
            >
              <planeGeometry args={[0.2, 0.07]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <mesh
              position={[-0.32, 0, 0]}
              raycast={ignoreRaycast}
              renderOrder={renderOrder}
            >
              <planeGeometry args={[0.2, 0.07]} />
              <meshBasicMaterial color={color} />
            </mesh>
          </>
        ) : null}
      </Billboard>
    </group>
  );
}
