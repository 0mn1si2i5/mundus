import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DataTexture,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  UnsignedByteType,
  Vector3,
  type ShaderMaterial,
} from 'three';
import type { CircleGlobePresentation } from '../modes/useModePresentation';
import { smallCirclePoints } from '../isolation/isolationGeometry';
import { EARTH_RADIUS_KM } from '../circle/circleProfile.mjs';
import { geoToVector3 } from './geo';
import { ignoreRaycast } from './sceneUtils';
import { CIRCLE_RENDERING } from './rendering';
import { useReducedMotion } from './useReducedMotion';

const VERTEX_SHADER = `
  varying vec3 vObjectNormal;
  void main() {
    vObjectNormal = normalize(normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Population density is drawn from an equirectangular texture (row 0 north),
// sampled with the same longitude convention as geoToVector3. Outside the
// circle a paper veil fades the land and density is dimmed.
const FRAGMENT_SHADER = `
  uniform sampler2D uDensity;
  uniform float uHasDensity;
  uniform vec3 uCentre;
  uniform float uRadius;
  uniform vec3 uDensityColor;
  uniform vec3 uVeilColor;
  uniform float uVeilAlpha;
  uniform float uInsideDensityAlpha;
  uniform float uOutsideDensityAlpha;
  varying vec3 vObjectNormal;
  const float PI = 3.141592653589793;
  void main() {
    vec3 n = normalize(vObjectNormal);
    float latitude = asin(clamp(n.y, -1.0, 1.0));
    float longitude = atan(n.x, n.z);
    vec2 uv = vec2(longitude / (2.0 * PI) + 0.5, 0.5 - latitude / PI);
    float density = uHasDensity * texture2D(uDensity, uv).r;
    float angle = acos(clamp(dot(n, uCentre), -1.0, 1.0));
    float inside = 1.0 - smoothstep(uRadius - 0.0015, uRadius + 0.0015, angle);
    float densityAlpha = smoothstep(0.22, 1.0, density) *
      mix(uOutsideDensityAlpha, uInsideDensityAlpha, inside);
    float veilAlpha = uVeilAlpha * (1.0 - inside);
    float alpha = densityAlpha + veilAlpha * (1.0 - densityAlpha);
    if (alpha < 0.002) discard;
    vec3 color = (uDensityColor * densityAlpha +
      uVeilColor * veilAlpha * (1.0 - densityAlpha)) / alpha;
    gl_FragColor = vec4(color, alpha);
  }
`;

const GROW_MS = 800;

export function CircleLayer({
  circle,
  sphereSegments,
}: {
  circle: CircleGlobePresentation;
  sphereSegments: [number, number];
}) {
  const material = useRef<ShaderMaterial>(null);
  const invalidate = useThree((state) => state.invalidate);
  const reducedMotion = useReducedMotion();
  const targetRadiusKm = circle.radiusKm;
  const [shownRadiusKm, setShownRadiusKm] = useState(
    reducedMotion ? targetRadiusKm : 0,
  );
  const growth = useRef<{ startedAt: number | null } | null>(null);
  const centreKey = `${circle.centre.latitude},${circle.centre.longitude}`;
  const grownKey = useRef<string | null>(null);

  // A new centre (or the first result) grows the circle from its centre;
  // slider changes and reduced motion apply the radius immediately.
  useEffect(() => {
    if (targetRadiusKm === null) return;
    if (!reducedMotion && grownKey.current !== centreKey) {
      grownKey.current = centreKey;
      growth.current = { startedAt: null };
      invalidate();
      return;
    }
    grownKey.current = centreKey;
    if (!growth.current) setShownRadiusKm(targetRadiusKm);
  }, [centreKey, invalidate, reducedMotion, targetRadiusKm]);

  useFrame(({ clock }) => {
    const current = growth.current;
    if (!current || targetRadiusKm === null) return;
    const now = clock.elapsedTime * 1000;
    current.startedAt ??= now;
    const progress = Math.min(1, (now - current.startedAt) / GROW_MS);
    const eased = 1 - (1 - progress) ** 3;
    setShownRadiusKm(targetRadiusKm * eased);
    if (progress >= 1) growth.current = null;
    else invalidate();
  });

  const texture = useMemo(() => {
    if (!circle.displayDensity) return null;
    const result = new DataTexture(
      circle.displayDensity,
      circle.gridWidth,
      circle.gridHeight,
      RedFormat,
      UnsignedByteType,
    );
    result.wrapS = RepeatWrapping;
    result.wrapT = ClampToEdgeWrapping;
    result.magFilter = LinearFilter;
    result.minFilter = LinearFilter;
    result.generateMipmaps = false;
    result.flipY = false;
    result.needsUpdate = true;
    return result;
  }, [circle.displayDensity, circle.gridHeight, circle.gridWidth]);
  useEffect(() => () => texture?.dispose(), [texture]);

  const uniforms = useMemo(
    () => ({
      uDensity: { value: null as DataTexture | null },
      uHasDensity: { value: 0 },
      uCentre: { value: new Vector3(0, 0, 1) },
      uRadius: { value: 0 },
      uDensityColor: { value: CIRCLE_RENDERING.density.color.clone() },
      uVeilColor: { value: CIRCLE_RENDERING.veil.color.clone() },
      uVeilAlpha: { value: CIRCLE_RENDERING.veil.alpha },
      uInsideDensityAlpha: { value: CIRCLE_RENDERING.density.insideAlpha },
      uOutsideDensityAlpha: { value: CIRCLE_RENDERING.density.outsideAlpha },
    }),
    [],
  );
  const radiusKm = shownRadiusKm ?? 0;
  useEffect(() => {
    const current = material.current;
    if (!current) return;
    current.uniforms.uDensity!.value = texture;
    current.uniforms.uHasDensity!.value = texture ? 1 : 0;
    (current.uniforms.uCentre!.value as Vector3).copy(
      geoToVector3(circle.centre).normalize(),
    );
    current.uniforms.uRadius!.value =
      circle.radiusKm === null ? 0 : radiusKm / EARTH_RADIUS_KM;
    current.uniformsNeedUpdate = true;
    invalidate();
  }, [circle.centre, circle.radiusKm, invalidate, radiusKm, texture]);
  useEffect(() => () => material.current?.dispose(), []);

  const ring = useMemo(
    () =>
      circle.radiusKm === null || radiusKm <= 0
        ? []
        : smallCirclePoints(circle.centre, radiusKm / EARTH_RADIUS_KM, 192).map(
            (point) => geoToVector3(point, CIRCLE_RENDERING.ring.radius),
          ),
    [circle.centre, circle.radiusKm, radiusKm],
  );

  return (
    <>
      <mesh
        scale={CIRCLE_RENDERING.surface.radius}
        renderOrder={CIRCLE_RENDERING.surface.renderOrder}
        raycast={ignoreRaycast}
      >
        <sphereGeometry args={[1, ...sphereSegments]} />
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          transparent
          depthTest
          depthWrite={false}
        />
      </mesh>
      {ring.length > 1 ? (
        <Line
          points={ring}
          color={CIRCLE_RENDERING.ring.color}
          lineWidth={1.6}
          transparent
          opacity={0.95}
          depthWrite={false}
          renderOrder={CIRCLE_RENDERING.ring.renderOrder}
          raycast={ignoreRaycast}
        />
      ) : null}
    </>
  );
}
