import { useFrame, useThree } from '@react-three/fiber';
import { Billboard, Line } from '@react-three/drei';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type Ref,
  type RefObject,
} from 'react';
import type { Group, PerspectiveCamera, ShaderMaterial } from 'three';
import { Color, Vector3 } from 'three';
import { geoToVector3 } from './geo';
import { GLOBE_COLOR_CONTRACT, SUNLINE_RENDERING } from './rendering';
import type {
  ProjectedMarkerEvidence,
  SunlineDiagnosticReason,
} from './viewportDiagnostics';

export interface SunlineDiagnosticHandle {
  request: (reason: SunlineDiagnosticReason) => void;
}

const SUNLINE_VERTEX_SHADER = `
  varying vec3 vObjectNormal;
  void main() {
    vObjectNormal = normalize(normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SUNLINE_FRAGMENT_SHADER = `
  uniform vec3 uSunDirection;
  uniform vec3 uNightColor;
  uniform vec3 uTwilightColor;
  uniform float uNightAlpha;
  varying vec3 vObjectNormal;
  void main() {
    float sunDot = clamp(dot(normalize(vObjectNormal), normalize(uSunDirection)), -1.0, 1.0);
    float altitude = asin(sunDot);
    float twilight = smoothstep(radians(-6.0), 0.0, altitude);
    vec3 color = mix(uNightColor, uTwilightColor, twilight);
    float alpha = mix(uNightAlpha, 0.0, twilight);
    gl_FragColor = vec4(color, alpha);
  }
`;

const AUXILIARY_LATITUDES = [
  { latitude: 0, opacity: 0.45 },
  { latitude: 23.436, opacity: 0.3 },
  { latitude: -23.436, opacity: 0.3 },
  { latitude: 66.564, opacity: 0.22 },
  { latitude: -66.564, opacity: 0.22 },
] as const;

export function SunlineLayer({
  sunDirection,
  solarMarkerPosition,
  sphereSegments,
}: {
  sunDirection: Vector3;
  solarMarkerPosition: Vector3;
  sphereSegments: [number, number];
}) {
  const material = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uSunDirection: { value: new Vector3() },
      uNightColor: { value: new Color(SUNLINE_RENDERING.night.color) },
      uTwilightColor: { value: new Color(SUNLINE_RENDERING.twilight.color) },
      uNightAlpha: { value: SUNLINE_RENDERING.night.maxAlpha },
    }),
    [],
  );
  const latitudeLines = useMemo(
    () =>
      AUXILIARY_LATITUDES.map(({ latitude, opacity }) => ({
        latitude,
        opacity,
        points: Array.from({ length: 121 }, (_, index) =>
          geoToVector3({ latitude, longitude: -180 + index * 3 }, 1.014),
        ),
      })),
    [],
  );

  useEffect(() => {
    uniforms.uSunDirection.value.copy(sunDirection);
    if (material.current) material.current.uniformsNeedUpdate = true;
  }, [sunDirection, uniforms]);

  useEffect(() => () => material.current?.dispose(), []);

  return (
    <>
      <mesh
        scale={SUNLINE_RENDERING.mask.radius}
        renderOrder={SUNLINE_RENDERING.mask.renderOrder}
      >
        <sphereGeometry args={[1, ...sphereSegments]} />
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={SUNLINE_VERTEX_SHADER}
          fragmentShader={SUNLINE_FRAGMENT_SHADER}
          transparent
          depthTest={SUNLINE_RENDERING.mask.depthTest}
          depthWrite={SUNLINE_RENDERING.mask.depthWrite}
        />
      </mesh>
      {latitudeLines.map((line) => (
        <Line
          key={line.latitude}
          points={line.points}
          color="#d7c58c"
          lineWidth={line.latitude === 0 ? 1.2 : 0.8}
          transparent
          opacity={line.opacity}
          depthTest
        />
      ))}
      <SolarMarker
        position={solarMarkerPosition}
        color={GLOBE_COLOR_CONTRACT.sunline.subsolar}
      />
    </>
  );
}

export const SunlineProjectionDiagnostic = forwardRef(
  function SunlineProjectionDiagnostic(
    {
      globeGroup,
      selectedPosition,
      selectedSurfacePosition,
      solarPosition,
      onDiagnostic,
    }: {
      globeGroup: RefObject<Group | null>;
      selectedPosition: Vector3;
      selectedSurfacePosition: Vector3;
      solarPosition: Vector3;
      onDiagnostic: (
        selected: ProjectedMarkerEvidence,
        selectedSurface: ProjectedMarkerEvidence,
        solar: ProjectedMarkerEvidence,
        reason: SunlineDiagnosticReason,
      ) => void;
    },
    ref: Ref<SunlineDiagnosticHandle>,
  ) {
    const pending = useRef<SunlineDiagnosticReason | null>('mount');
    const selectedWorld = useRef(new Vector3());
    const selectedSurfaceWorld = useRef(new Vector3());
    const solarWorld = useRef(new Vector3());
    const surfaceNormal = useRef(new Vector3());
    const cameraOffset = useRef(new Vector3());
    const projected = useRef(new Vector3());
    const { camera, size, invalidate } = useThree();
    const diagnosticSize = useRef(`${size.width}x${size.height}`);

    useImperativeHandle(ref, () => ({
      request(reason) {
        pending.current = reason;
      },
    }));
    useEffect(() => {
      pending.current = 'position';
      invalidate();
    }, [invalidate, selectedPosition, selectedSurfacePosition, solarPosition]);
    useEffect(() => {
      const nextSize = `${size.width}x${size.height}`;
      if (diagnosticSize.current === nextSize) return;
      diagnosticSize.current = nextSize;
      pending.current = 'resize';
      invalidate();
    }, [invalidate, size.height, size.width]);

    useFrame(() => {
      if (!pending.current) return;
      const group = globeGroup.current;
      if (!group) return;
      group.updateWorldMatrix(true, false);
      selectedWorld.current
        .copy(selectedPosition)
        .applyMatrix4(group.matrixWorld);
      selectedSurfaceWorld.current
        .copy(selectedSurfacePosition)
        .normalize()
        .applyMatrix4(group.matrixWorld);
      solarWorld.current.copy(solarPosition).applyMatrix4(group.matrixWorld);
      const reason = pending.current;
      pending.current = null;
      onDiagnostic(
        projectMarkerEvidence(
          selectedWorld.current,
          camera as PerspectiveCamera,
          size.width,
          size.height,
          surfaceNormal.current,
          cameraOffset.current,
          projected.current,
        ),
        projectMarkerEvidence(
          selectedSurfaceWorld.current,
          camera as PerspectiveCamera,
          size.width,
          size.height,
          surfaceNormal.current,
          cameraOffset.current,
          projected.current,
        ),
        projectMarkerEvidence(
          solarWorld.current,
          camera as PerspectiveCamera,
          size.width,
          size.height,
          surfaceNormal.current,
          cameraOffset.current,
          projected.current,
        ),
        reason,
      );
    });

    return null;
  },
);

function projectMarkerEvidence(
  worldPosition: Vector3,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  surfaceNormal: Vector3,
  cameraOffset: Vector3,
  projected: Vector3,
): ProjectedMarkerEvidence {
  surfaceNormal.copy(worldPosition).normalize();
  cameraOffset.subVectors(camera.position, worldPosition);
  projected.copy(worldPosition).project(camera);
  return {
    x: Number((((projected.x + 1) * width) / 2).toFixed(3)),
    y: Number((((1 - projected.y) * height) / 2).toFixed(3)),
    frontFacing: surfaceNormal.dot(cameraOffset) > 0,
  };
}

function SolarMarker({
  position,
  color,
}: {
  position: Vector3;
  color: string;
}) {
  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh renderOrder={SUNLINE_RENDERING.solarMarker.renderOrder}>
        <sphereGeometry args={[0.025, 20, 20]} />
        <meshBasicMaterial
          color={color}
          depthTest={SUNLINE_RENDERING.solarMarker.depthTest}
          depthWrite={SUNLINE_RENDERING.solarMarker.depthWrite}
        />
      </mesh>
      <Billboard>
        <mesh renderOrder={SUNLINE_RENDERING.solarMarker.renderOrder}>
          <ringGeometry args={[0.04, 0.052, 28]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.7}
            side={2}
            depthTest={SUNLINE_RENDERING.solarMarker.depthTest}
            depthWrite={SUNLINE_RENDERING.solarMarker.depthWrite}
          />
        </mesh>
      </Billboard>
    </group>
  );
}
