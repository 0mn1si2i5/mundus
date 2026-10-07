import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import { Color, FrontSide } from 'three';
import {
  ANTIPODE_DRAG_RENDERING,
  GLOBE_RENDERING,
  getAntipodeDragSurfaceProps,
  getVectorSurfaceRenderOrders,
  getVectorLineMaterialProps,
} from './rendering';
import type { QualityProfile } from './quality';
import {
  createVectorGlobeResources,
  updateVectorPalette,
  type VectorGlobeResources,
} from './vectorGlobe';
import { loadVectorGlobe } from './vectorGlobeLoader';
import { COUNTRY_TEXTURE_STYLE } from './countryData';
import { ignoreRaycast } from './sceneUtils';

export type VectorGlobeState = 'loading' | 'ready' | 'error';

interface VectorGlobeLayerProps {
  profile: QualityProfile;
  hoveredCountryId: string | null;
  selectedCountryId: string | null;
  dragActive: boolean;
  onStateChange: (
    state: VectorGlobeState,
    resources: VectorGlobeResources | null,
  ) => void;
  onPaletteUpdate: (version: number) => void;
  onDragMaterialChange: (transparent: boolean) => void;
  onDragEvidence: (alphaEvidence: string, orderEvidence: string) => void;
  sunlineActive: boolean;
  onSunlineHighlightChange: (evidence: string | null) => void;
  onRenderEvidence: (vectorDraws: number, rendererCalls: number) => void;
  renderSampleKey: number;
}

const VERTEX_SHADER = `
  attribute float countryIndex;
  varying float vCountryIndex;
  varying vec3 vObjectNormal;
  void main() {
    vCountryIndex = countryIndex;
    vObjectNormal = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D uPalette;
  uniform float uPaletteWidth;
  uniform float uOpacity;
  uniform vec3 uAmbientColor;
  uniform vec3 uDirectionalColor;
  varying float vCountryIndex;
  varying vec3 vObjectNormal;
  void main() {
    vec3 base = texture2D(
      uPalette,
      vec2((vCountryIndex + 0.5) / uPaletteWidth, 0.5)
    ).rgb;
    float light = max(dot(normalize(vObjectNormal), normalize(vec3(-3.0, 2.0, 4.0))), 0.0);
    vec3 lit = base * (uAmbientColor + uDirectionalColor * light);
    gl_FragColor = vec4(lit, uOpacity);
    #include <colorspace_fragment>
  }
`;

const HIGHLIGHT_FRAGMENT_SHADER = `
  uniform float uSelectedCountryIndex;
  varying float vCountryIndex;
  void main() {
    if (abs(vCountryIndex - uSelectedCountryIndex) > 0.5) discard;
    gl_FragColor = vec4(0.72, 0.34, 0.22, 0.72);
    #include <colorspace_fragment>
  }
`;

export function VectorGlobeLayer({
  profile,
  hoveredCountryId,
  selectedCountryId,
  dragActive,
  onStateChange,
  onPaletteUpdate,
  onDragMaterialChange,
  onDragEvidence,
  sunlineActive,
  onSunlineHighlightChange,
  onRenderEvidence,
  renderSampleKey,
}: VectorGlobeLayerProps) {
  const [resources, setResources] = useState<VectorGlobeResources | null>(null);
  const oceanMesh = useRef<Mesh>(null);
  const landMesh = useRef<Mesh>(null);
  const material = useRef<ShaderMaterial>(null);
  const oceanMaterial = useRef<MeshStandardMaterial>(null);
  const sunlineHighlight = useRef<Mesh>(null);
  const sunlineHighlightMaterial = useRef<ShaderMaterial>(null);
  const { gl, invalidate } = useThree();
  const frameDraws = useRef(0);
  const countedFrame = useRef(-1);
  const samplePending = useRef(false);
  const sampleScheduled = useRef(false);
  const dragSurface = getAntipodeDragSurfaceProps();
  const surfaceRenderOrders = getVectorSurfaceRenderOrders(dragActive);
  const vectorLineMaterials = getVectorLineMaterialProps(dragActive);
  const selectedCountryIndex =
    resources?.countries.find(
      (country) => country.countryId === selectedCountryId,
    )?.countryIndex ?? -1;
  function countVectorDraw(renderer: WebGLRenderer) {
    const frame = renderer.info.render.frame;
    if (countedFrame.current !== frame) {
      countedFrame.current = frame;
      frameDraws.current = 0;
    }
    frameDraws.current += 1;
  }
  const requestRenderEvidence = useEffectEvent(() => {
    samplePending.current = true;
    invalidate();
  });
  useFrame(() => {
    if (samplePending.current && !sampleScheduled.current) {
      samplePending.current = false;
      sampleScheduled.current = true;
      frameDraws.current = 0;
      requestAnimationFrame(() => {
        sampleScheduled.current = false;
        onRenderEvidence(frameDraws.current, gl.info.render.calls);
        frameDraws.current = 0;
      });
    }
  });
  useEffect(() => {
    if (resources) requestRenderEvidence();
  }, [renderSampleKey, resources]);

  useEffect(() => {
    let active = true;
    let allocated: VectorGlobeResources | null = null;
    onStateChange('loading', null);
    void loadVectorGlobe(profile.vectorDetail)
      .then((decoded) => {
        if (!active) return;
        allocated = createVectorGlobeResources(decoded);
        setResources(allocated);
        onStateChange('ready', allocated);
        onPaletteUpdate(allocated.palette.version);
        requestRenderEvidence();
        invalidate();
      })
      .catch(() => {
        if (!active) return;
        setResources(null);
        onStateChange('error', null);
        invalidate();
      });
    return () => {
      active = false;
      allocated?.dispose();
      setResources(null);
    };
  }, [invalidate, onPaletteUpdate, onStateChange, profile.vectorDetail]);

  useEffect(() => {
    if (!resources) return;
    updateVectorPalette(resources, hoveredCountryId, selectedCountryId);
    onPaletteUpdate(resources.palette.version);
    requestRenderEvidence();
    invalidate();
  }, [
    hoveredCountryId,
    invalidate,
    onPaletteUpdate,
    resources,
    selectedCountryId,
  ]);

  useEffect(() => {
    const shader = material.current;
    const oceanSurface = oceanMesh.current;
    const landSurface = landMesh.current;
    if (!shader || !oceanSurface || !landSurface) return;
    shader.uniforms.uOpacity!.value = dragActive
      ? dragSurface.landLayerAlpha
      : 1;
    shader.depthWrite = !dragActive;
    shader.transparent = dragActive;
    shader.needsUpdate = true;
    const ocean = oceanMaterial.current;
    if (ocean) {
      ocean.opacity = dragActive ? dragSurface.oceanAlpha : 1;
      ocean.transparent = dragActive;
      ocean.depthWrite = !dragActive;
      ocean.needsUpdate = true;
    }
    onDragMaterialChange(dragActive);
    onDragEvidence(
      `oceanAlpha:${ocean?.opacity ?? 1},landLayerAlpha:${shader.uniforms.uOpacity!.value},effectiveCompositeAlpha:${dragActive ? dragSurface.compositeLandAlpha : 1}`,
      `innerWall:${ANTIPODE_DRAG_RENDERING.innerWall.renderOrder},ocean:${oceanSurface.renderOrder},land:${landSurface.renderOrder},highlight:${ANTIPODE_DRAG_RENDERING.highlight.renderOrder},markers:${ANTIPODE_DRAG_RENDERING.markerRenderOrder}`,
    );
    requestRenderEvidence();
    invalidate();
  }, [
    dragActive,
    dragSurface.landLayerAlpha,
    dragSurface.oceanAlpha,
    dragSurface.compositeLandAlpha,
    invalidate,
    onDragEvidence,
    onDragMaterialChange,
  ]);

  useEffect(() => {
    const mesh = sunlineHighlight.current;
    const shader = sunlineHighlightMaterial.current;
    if (!mesh || !shader || !sunlineActive || selectedCountryIndex < 0) {
      onSunlineHighlightChange(null);
      return;
    }
    shader.uniforms.uSelectedCountryIndex!.value = selectedCountryIndex;
    onSunlineHighlightChange(
      `visible:${mesh.visible},renderOrder:${mesh.renderOrder},radius:${mesh.scale.x},depthWrite:${shader.depthWrite}`,
    );
    requestRenderEvidence();
    invalidate();
  }, [
    invalidate,
    onSunlineHighlightChange,
    selectedCountryIndex,
    sunlineActive,
  ]);

  if (!resources) return null;

  return (
    <>
      <mesh
        ref={oceanMesh}
        renderOrder={surfaceRenderOrders.ocean}
        raycast={ignoreRaycast}
        onBeforeRender={countVectorDraw}
      >
        <sphereGeometry args={[0.997, ...profile.sphereSegments]} />
        <meshStandardMaterial
          ref={oceanMaterial}
          color={COUNTRY_TEXTURE_STYLE.oceanColor}
          roughness={GLOBE_RENDERING.material.roughness}
          metalness={GLOBE_RENDERING.material.metalness}
          transparent={dragActive}
          opacity={dragActive ? dragSurface.oceanAlpha : 1}
          depthWrite={!dragActive}
        />
      </mesh>
      <mesh
        ref={landMesh}
        geometry={resources.surface}
        renderOrder={surfaceRenderOrders.land}
        raycast={ignoreRaycast}
        onBeforeRender={countVectorDraw}
      >
        <shaderMaterial
          ref={material}
          uniforms={{
            uPalette: { value: resources.palette },
            uPaletteWidth: { value: resources.palette.image.width },
            uOpacity: {
              value: dragActive ? dragSurface.landLayerAlpha : 1,
            },
            uAmbientColor: {
              value: new Color(GLOBE_RENDERING.ambient.color).multiplyScalar(
                GLOBE_RENDERING.ambient.intensity * 0.55,
              ),
            },
            uDirectionalColor: {
              value: new Color(
                GLOBE_RENDERING.directional.color,
              ).multiplyScalar(GLOBE_RENDERING.directional.intensity * 0.45),
            },
          }}
          vertexShader={VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          transparent={dragActive}
          side={FrontSide}
          depthTest
          depthWrite={!dragActive}
        />
      </mesh>
      <lineSegments
        geometry={resources.coastline}
        scale={1.001}
        renderOrder={1}
        raycast={ignoreRaycast}
        onBeforeRender={countVectorDraw}
      >
        <lineBasicMaterial {...vectorLineMaterials.coastline} />
      </lineSegments>
      {sunlineActive && selectedCountryIndex >= 0 ? (
        <mesh
          ref={sunlineHighlight}
          geometry={resources.surface}
          scale={1.014}
          renderOrder={4}
          raycast={ignoreRaycast}
          onBeforeRender={countVectorDraw}
        >
          <shaderMaterial
            ref={sunlineHighlightMaterial}
            uniforms={{
              uSelectedCountryIndex: { value: selectedCountryIndex },
            }}
            vertexShader={VERTEX_SHADER}
            fragmentShader={HIGHLIGHT_FRAGMENT_SHADER}
            transparent
            depthTest
            depthWrite={false}
          />
        </mesh>
      ) : null}
      <lineSegments
        geometry={resources.borders}
        scale={1.002}
        renderOrder={1}
        raycast={ignoreRaycast}
        onBeforeRender={countVectorDraw}
      >
        <lineBasicMaterial {...vectorLineMaterials.borders} />
      </lineSegments>
    </>
  );
}
