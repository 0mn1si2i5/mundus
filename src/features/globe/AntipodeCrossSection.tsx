import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import type { Mesh, MeshBasicMaterial } from 'three';
import { createAntipodeCrossSection, createLineSegmentPositions } from './geo';
import { ANTIPODE_DRAG_RENDERING, GLOBE_COLOR_CONTRACT } from './rendering';
import { ignoreRaycast } from './sceneUtils';

export function AntipodeCrossSection({
  section,
}: {
  section: ReturnType<typeof createAntipodeCrossSection>;
}) {
  const interiorPositions = useMemo(
    () => createLineSegmentPositions(section.interiorSegments),
    [section],
  );

  return (
    <>
      {section.surfaceSegments.map((points, index) => (
        <Line
          key={`surface-${index}`}
          points={points}
          color={GLOBE_COLOR_CONTRACT.crossSection.surface}
          lineWidth={1.2}
          transparent
          opacity={1}
          depthTest
          raycast={ignoreRaycast}
        />
      ))}
      <lineSegments raycast={ignoreRaycast}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[interiorPositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={GLOBE_COLOR_CONTRACT.crossSection.interior}
          transparent
          opacity={0.52}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
      <mesh position={section.center} raycast={ignoreRaycast}>
        <sphereGeometry args={[0.012, 12, 12]} />
        <meshBasicMaterial
          color={GLOBE_COLOR_CONTRACT.crossSection.center}
          transparent
          opacity={0.72}
          depthTest={false}
          depthWrite={ANTIPODE_DRAG_RENDERING.centerNode.depthWrite}
        />
      </mesh>
    </>
  );
}

export function CenterCandleGlow({
  active,
  reducedMotion,
  diagnosticsEnabled,
  onFrame,
  onMode,
}: {
  active: boolean;
  reducedMotion: boolean;
  diagnosticsEnabled: boolean;
  onFrame: (revision: number) => void;
  onMode: (mode: 'static' | 'deterministic') => void;
}) {
  const core = useRef<Mesh>(null);
  const halo = useRef<Mesh>(null);
  const coreMaterial = useRef<MeshBasicMaterial>(null);
  const haloMaterial = useRef<MeshBasicMaterial>(null);
  const frameRevision = useRef(0);
  const lastReportedAt = useRef(0);
  const { invalidate, setFrameloop } = useThree();

  useFrame(({ clock }) => {
    if (!active || reducedMotion) return;
    frameRevision.current += 1;
    const flicker =
      1 +
      ANTIPODE_DRAG_RENDERING.centerGlow.flickerAmplitude *
        (0.62 * Math.sin(clock.elapsedTime * 11.3) +
          0.38 * Math.sin(clock.elapsedTime * 17.1 + 0.7));
    core.current?.scale.setScalar(flicker);
    halo.current?.scale.setScalar(2 - flicker);
    if (coreMaterial.current) {
      coreMaterial.current.opacity =
        ANTIPODE_DRAG_RENDERING.centerGlow.core.opacity * flicker;
    }
    if (haloMaterial.current) {
      haloMaterial.current.opacity =
        ANTIPODE_DRAG_RENDERING.centerGlow.halo.opacity * flicker;
    }
    if (
      diagnosticsEnabled &&
      clock.elapsedTime - lastReportedAt.current >= 0.1
    ) {
      lastReportedAt.current = clock.elapsedTime;
      onFrame(frameRevision.current);
    }
    invalidate();
  });

  useEffect(() => {
    if (active) onMode(reducedMotion ? 'static' : 'deterministic');
    if (active) {
      frameRevision.current = 0;
      lastReportedAt.current = -Infinity;
      invalidate();
    }
    if (active && !reducedMotion) return;
    core.current?.scale.setScalar(1);
    halo.current?.scale.setScalar(1);
    if (coreMaterial.current) {
      coreMaterial.current.opacity =
        ANTIPODE_DRAG_RENDERING.centerGlow.core.opacity;
    }
    if (haloMaterial.current) {
      haloMaterial.current.opacity =
        ANTIPODE_DRAG_RENDERING.centerGlow.halo.opacity;
    }
  }, [active, diagnosticsEnabled, invalidate, onMode, reducedMotion]);
  useEffect(() => {
    setFrameloop(active && !reducedMotion ? 'always' : 'demand');
    return () => setFrameloop('demand');
  }, [active, reducedMotion, setFrameloop]);

  return (
    <group
      visible={active}
      renderOrder={ANTIPODE_DRAG_RENDERING.centerGlow.renderOrder}
    >
      <mesh ref={core} raycast={ignoreRaycast}>
        <sphereGeometry
          args={[ANTIPODE_DRAG_RENDERING.centerGlow.core.radius, 16, 16]}
        />
        <meshBasicMaterial
          ref={coreMaterial}
          color={ANTIPODE_DRAG_RENDERING.centerGlow.core.color}
          transparent
          opacity={ANTIPODE_DRAG_RENDERING.centerGlow.core.opacity}
          depthTest={ANTIPODE_DRAG_RENDERING.centerGlow.core.depthTest}
          depthWrite={ANTIPODE_DRAG_RENDERING.centerGlow.core.depthWrite}
        />
      </mesh>
      <mesh ref={halo} raycast={ignoreRaycast}>
        <sphereGeometry
          args={[ANTIPODE_DRAG_RENDERING.centerGlow.halo.radius, 20, 20]}
        />
        <meshBasicMaterial
          ref={haloMaterial}
          color={ANTIPODE_DRAG_RENDERING.centerGlow.halo.color}
          transparent
          opacity={ANTIPODE_DRAG_RENDERING.centerGlow.halo.opacity}
          depthTest={ANTIPODE_DRAG_RENDERING.centerGlow.halo.depthTest}
          depthWrite={ANTIPODE_DRAG_RENDERING.centerGlow.halo.depthWrite}
        />
      </mesh>
    </group>
  );
}
