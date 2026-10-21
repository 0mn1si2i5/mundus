import { Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  DataTexture,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  type BufferGeometry,
} from 'three';
import type { ClimateDataset } from '../climate/climateMetrics';
import { KOPPEN_CLASSES } from '../climate/koppenClasses';
import { geoToVector3 } from './geo';
import { ignoreRaycast } from './sceneUtils';

const VERTEX_SHADER = `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Classes are drawn on the Natural Earth land surface, so the vector coast
// stays crisp; land cells the raster leaves unclassified use a neutral tone.
const FRAGMENT_SHADER = `
uniform sampler2D uClasses;
uniform sampler2D uPalette;
uniform vec2 uSize;
uniform float uWest;
uniform float uNorth;
uniform float uStep;
uniform float uSelected;
varying vec3 vDirection;
void main() {
  vec3 direction = normalize(vDirection);
  float longitude = degrees(atan(direction.x, direction.z));
  float latitude = degrees(asin(clamp(direction.y, -1.0, 1.0)));
  vec2 cell = floor(vec2(mod(longitude - uWest + 360.0, 360.0), uNorth - latitude) / uStep);
  cell = clamp(cell, vec2(0.0), uSize - 1.0);
  float value = floor(texture2D(uClasses, (cell + 0.5) / uSize).r * 255.0 + 0.5);
  vec3 color = value < 0.5
    ? vec3(0.62, 0.64, 0.62)
    : texture2D(uPalette, vec2((value - 0.5) / 32.0, 0.5)).rgb;
  if (uSelected > 0.5 && abs(value - uSelected) > 0.5)
    color = mix(color, vec3(0.55, 0.57, 0.56), 0.72) * 0.62;
  float light = 0.72 + 0.28 * max(dot(direction, normalize(vec3(-3.0, 2.0, 4.0))), 0.0);
  gl_FragColor = vec4(color * light, 1.0);
  #include <colorspace_fragment>
}`;

function nearestTexture(texture: DataTexture) {
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export function createClimatePalette(): Uint8Array {
  const bytes = new Uint8Array(32 * 4);
  for (const type of KOPPEN_CLASSES)
    bytes.set([...type.rgb, 255], (type.value - 1) * 4);
  return bytes;
}

export function ClimateLayer({
  surface,
  dataset,
  selectedValue,
  latitude,
}: {
  surface: BufferGeometry;
  dataset: ClimateDataset;
  selectedValue: number | null;
  latitude: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const material = useMemo(() => {
    const { grid } = dataset;
    const classes = nearestTexture(
      new DataTexture(
        dataset.classes,
        grid.width,
        grid.height,
        RedFormat,
        UnsignedByteType,
      ),
    );
    classes.unpackAlignment = 1;
    const palette = nearestTexture(
      new DataTexture(
        createClimatePalette(),
        32,
        1,
        RGBAFormat,
        UnsignedByteType,
      ),
    );
    return new ShaderMaterial({
      uniforms: {
        uClasses: { value: classes },
        uPalette: { value: palette },
        uSize: { value: [grid.width, grid.height] },
        uWest: { value: grid.west },
        uNorth: { value: grid.north },
        uStep: { value: grid.step },
        uSelected: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: true,
      depthWrite: false,
    });
  }, [dataset]);
  useEffect(
    () => () => {
      (material.uniforms.uClasses!.value as DataTexture).dispose();
      (material.uniforms.uPalette!.value as DataTexture).dispose();
      material.dispose();
    },
    [material],
  );
  useEffect(() => {
    material.uniforms.uSelected!.value = selectedValue ?? 0;
    invalidate();
  }, [invalidate, material, selectedValue]);
  const circle = useMemo(() => {
    const points = Array.from({ length: 145 }, (_, index) =>
      geoToVector3({ latitude, longitude: index * 2.5 - 180 }, 1.008),
    );
    return points;
  }, [latitude]);
  return (
    <>
      <mesh
        geometry={surface}
        material={material}
        scale={1.004}
        renderOrder={2}
        raycast={ignoreRaycast}
        dispose={null}
      />
      <Line
        points={circle}
        color="#f3c56b"
        lineWidth={1.6}
        transparent
        opacity={0.95}
        depthTest
        renderOrder={4}
        raycast={ignoreRaycast}
      />
    </>
  );
}
