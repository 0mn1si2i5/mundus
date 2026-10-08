import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  Color,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  type BufferGeometry,
  type ShaderMaterial,
} from 'three';
import type {
  IsolationFieldSite,
  IsolationFieldTable,
} from '../isolation/isolationField';
import { EARTH_RADIUS_KM } from '../isolation/isolationMetric';
import { ignoreRaycast } from './sceneUtils';

const VERTEX_SHADER = `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

function fieldFragmentShader(maxCandidates: number) {
  return `
uniform sampler2D uTiles;
uniform sampler2D uCandidates;
uniform sampler2D uSites;
uniform sampler2D uColors;
uniform vec2 uTileSize;
uniform vec2 uCandidateSize;
uniform float uSiteCount;
uniform float uSelected;
varying vec3 vDirection;
void main() {
  vec3 direction = normalize(vDirection);
  float longitude = atan(direction.x, direction.z);
  float latitude = asin(clamp(direction.y, -1.0, 1.0));
  vec2 tile = floor(vec2((longitude + 3.14159265359) / 6.28318530718, (latitude + 1.57079632679) / 3.14159265359) * uTileSize);
  tile = clamp(tile, vec2(0.0), uTileSize - 1.0);
  vec2 range = texture2D(uTiles, (tile + 0.5) / uTileSize).rg;
  float best = 1.0e20;
  float winner = -1.0;
  for (int i = 0; i < ${maxCandidates}; i++) {
    if (float(i) >= range.y) break;
    float entry = range.x + float(i);
    vec2 candidateUv = (vec2(mod(entry, uCandidateSize.x), floor(entry / uCandidateSize.x)) + 0.5) / uCandidateSize;
    float siteIndex = texture2D(uCandidates, candidateUv).r;
    vec4 site = texture2D(uSites, vec2((siteIndex + 0.5) / uSiteCount, 0.5));
    float score = acos(clamp(dot(direction, normalize(site.xyz)), -1.0, 1.0)) * site.w;
    if (score < best) {
      best = score;
      winner = siteIndex;
    }
  }
  vec3 color = texture2D(uColors, vec2((winner + 0.5) / uSiteCount, 0.5)).rgb;
  if (abs(winner - uSelected) < 0.5) color = mix(color, vec3(0.88, 0.67, 0.38), 0.55);
  // Candidate tiles preserve winners, not runners-up. Draw edges from changes
  // in the winning id so a tile's pruned second choice cannot create seams.
  float boundary = min(1.0, fwidth(winner));
  color = mix(color, vec3(0.20, 0.25, 0.23), boundary * 0.70);
  float light = 0.70 + 0.30 * max(dot(direction, normalize(vec3(-3.0, 2.0, 4.0))), 0.0);
  gl_FragColor = vec4(color * light, 1.0);
  #include <colorspace_fragment>
}`;
}

function floatTexture(data: Float32Array, width: number, height: number) {
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function IsolationFieldLayer({
  surface,
  sites,
  table,
  selectedCityId,
  alpha,
  onRendered,
}: {
  surface: BufferGeometry;
  sites: readonly IsolationFieldSite[];
  table: IsolationFieldTable;
  selectedCityId: string;
  alpha: number;
  onRendered: (alpha: number) => void;
}) {
  const material = useRef<ShaderMaterial>(null);
  const rendered = useRef<IsolationFieldTable | null>(null);
  const { invalidate } = useThree();
  const textures = useMemo(() => {
    const siteData = new Float32Array(sites.length * 4);
    const colorData = new Float32Array(sites.length * 4);
    sites.forEach((site, index) => {
      siteData.set(
        [...site.direction, EARTH_RADIUS_KM / site.radiusKm],
        index * 4,
      );
      const hash = [...site.id].reduce(
        (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
        0,
      );
      const color = new Color().setHSL((hash * 0.61803398875) % 1, 0.28, 0.62);
      colorData.set([color.r, color.g, color.b, 1], index * 4);
    });
    const width = 1024;
    const height = Math.max(1, Math.ceil(table.candidates.length / 4 / width));
    const candidateData = new Float32Array(width * height * 4);
    candidateData.set(table.candidates);
    return {
      tiles: floatTexture(table.tiles, table.columns, table.rows),
      candidates: floatTexture(candidateData, width, height),
      sites: floatTexture(siteData, sites.length, 1),
      colors: floatTexture(colorData, sites.length, 1),
      size: [width, height],
    };
  }, [sites, table]);
  const uniforms = useMemo(
    () => ({
      uTiles: { value: textures.tiles },
      uCandidates: { value: textures.candidates },
      uSites: { value: textures.sites },
      uColors: { value: textures.colors },
      uTileSize: { value: [table.columns, table.rows] },
      uCandidateSize: { value: textures.size },
      uSiteCount: { value: sites.length },
      uSelected: { value: -1 },
    }),
    [sites.length, table, textures],
  );
  useEffect(() => {
    const shader = material.current;
    if (!shader) return;
    shader.uniforms.uSelected!.value = sites.findIndex(
      (site) => site.id === selectedCityId,
    );
    shader.uniformsNeedUpdate = true;
    invalidate();
  }, [invalidate, selectedCityId, sites]);
  useEffect(
    () => () => {
      textures.tiles.dispose();
      textures.candidates.dispose();
      textures.sites.dispose();
      textures.colors.dispose();
    },
    [textures],
  );
  return (
    <mesh
      geometry={surface}
      scale={1.004}
      renderOrder={2}
      raycast={ignoreRaycast}
      onBeforeRender={() => {
        if (rendered.current !== table) {
          rendered.current = table;
          onRendered(alpha);
        }
      }}
    >
      <shaderMaterial
        key={table.maxCandidates}
        ref={material}
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={fieldFragmentShader(table.maxCandidates)}
        depthTest
        depthWrite={false}
      />
    </mesh>
  );
}
