import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector4,
  type BufferGeometry,
  type WebGLRenderer,
  type Camera,
} from 'three';
import type {
  CityReachFrame,
  CityReachMetadata,
  DecodedDensityTexture,
} from '../isolation/cityReachTypes';
import { ignoreRaycast } from './sceneUtils';

const VERTEX_SHADER = `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

function fragmentShader(tileCount: number) {
  const declarations = Array.from(
    { length: tileCount },
    (_, index) =>
      `uniform sampler2D uOwner${index};\nuniform vec4 uBounds${index};`,
  ).join('\n');
  const branches = Array.from(
    { length: tileCount },
    (_, index) => `
  if (cell.x >= uBounds${index}.x && cell.y >= uBounds${index}.y &&
      cell.x < uBounds${index}.x + uBounds${index}.z && cell.y < uBounds${index}.y + uBounds${index}.w) {
    return texture2D(uOwner${index}, (cell - uBounds${index}.xy + 0.5) / uBounds${index}.zw);
  }`,
  ).join('\n');
  return `
${declarations}
uniform sampler2D uPalette;
uniform sampler2D uDensity;
uniform vec2 uPaletteSize;
uniform vec2 uSourceSize;
uniform vec2 uDisplaySize;
uniform vec2 uDensitySize;
uniform float uDensityStride;
uniform float uWest;
uniform float uNorth;
uniform float uStep;
uniform float uStride;
uniform float uSelected;
varying vec3 vDirection;
vec4 sampleCell(vec2 cell) {
  if (cell.y < 0.0 || cell.y >= uDisplaySize.y) return vec4(0.0);
  cell.x = mod(cell.x + uDisplaySize.x, uDisplaySize.x);
  ${branches}
  return vec4(0.0);
}
float ownerCode(vec4 pixel) {
  return floor(pixel.r * 255.0 + 0.5) + 256.0 * floor(pixel.g * 255.0 + 0.5);
}
void main() {
  vec3 direction = normalize(vDirection);
  float longitude = degrees(atan(direction.x, direction.z));
  float latitude = degrees(asin(clamp(direction.y, -1.0, 1.0)));
  vec2 sourceCell = floor(vec2(mod(longitude - uWest + 360.0, 360.0), uNorth - latitude) / uStep);
  if (sourceCell.y < 0.0 || sourceCell.y >= uSourceSize.y) discard;
  vec2 cell = floor(sourceCell / uStride);
  vec4 pixel = sampleCell(cell);
  float owner = ownerCode(pixel);
  vec3 color;
  if (owner > 65534.5) {
    float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 10.0));
    color = mix(vec3(0.16, 0.19, 0.19), vec3(0.42, 0.44, 0.43), hatch);
  } else if (owner < 0.5) {
    color = vec3(0.23, 0.27, 0.26);
  } else {
    vec2 paletteCell = vec2(mod(owner, uPaletteSize.x), floor(owner / uPaletteSize.x));
    color = texture2D(uPalette, (paletteCell + 0.5) / uPaletteSize).rgb;
    vec2 densityCell = floor(sourceCell / uDensityStride);
    float densityByte = floor(texture2D(uDensity, (densityCell + 0.5) / uDensitySize).r * 255.0 + 0.5);
    float brightness = densityByte > 254.5 ? 0.65 : 0.35 + 0.65 * densityByte / 254.0;
    color *= brightness;
    if (abs(owner - uSelected) < 0.5) color = mix(color, vec3(0.88, 0.67, 0.38), 0.45);
  }
  float boundary = 0.0;
  boundary = max(boundary, step(0.5, abs(owner - ownerCode(sampleCell(cell + vec2(1.0, 0.0))))));
  boundary = max(boundary, step(0.5, abs(owner - ownerCode(sampleCell(cell + vec2(-1.0, 0.0))))));
  boundary = max(boundary, step(0.5, abs(owner - ownerCode(sampleCell(cell + vec2(0.0, 1.0))))));
  boundary = max(boundary, step(0.5, abs(owner - ownerCode(sampleCell(cell + vec2(0.0, -1.0))))));
  color = mix(color, vec3(0.12, 0.15, 0.14), boundary * 0.45);
  float light = 0.70 + 0.30 * max(dot(direction, normalize(vec3(-3.0, 2.0, 4.0))), 0.0);
  gl_FragColor = vec4(color * light, 1.0);
  #include <colorspace_fragment>
}`;
}

function byteTexture(bytes: Uint8Array, width: number, height: number) {
  const texture = new DataTexture(
    bytes,
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

type FrameResources = {
  material: ShaderMaterial;
  textures: readonly DataTexture[];
  dispose(): void;
};

type SharedDensityResources = Map<
  DecodedDensityTexture,
  { texture: DataTexture; references: number }
>;

function prepareFrame(
  frame: CityReachFrame,
  metadata: CityReachMetadata,
  renderer: WebGLRenderer,
  camera: Camera,
  surface: BufferGeometry,
  densityResources: SharedDensityResources,
): FrameResources {
  if (frame.tiles.length + 2 > renderer.capabilities.maxTextures)
    throw new Error('City-reach texture samplers exceed this renderer');
  const textures: DataTexture[] = [];
  let material: ShaderMaterial | undefined;
  let releaseDensity = () => {};
  try {
    const uniforms: ShaderMaterial['uniforms'] = {
      uSourceSize: { value: [frame.grid.width, frame.grid.height] },
      uDisplaySize: { value: [frame.width, frame.height] },
      uDensitySize: { value: [frame.density.width, frame.density.height] },
      uDensityStride: { value: frame.densityStride },
      uWest: { value: frame.grid.west },
      uNorth: { value: frame.grid.north },
      uStep: { value: frame.grid.step },
      uStride: { value: frame.stride },
      uSelected: { value: -1 },
    };
    frame.tiles.forEach((tile, index) => {
      if (
        tile.width > renderer.capabilities.maxTextureSize ||
        tile.height > renderer.capabilities.maxTextureSize
      )
        throw new Error('City-reach texture exceeds this renderer');
      const texture = byteTexture(tile.rgba, tile.width, tile.height);
      textures.push(texture);
      uniforms[`uOwner${index}`] = { value: texture };
      uniforms[`uBounds${index}`] = {
        value: [tile.x, tile.y, tile.width, tile.height],
      };
    });
    if (
      frame.density.width > renderer.capabilities.maxTextureSize ||
      frame.density.height > renderer.capabilities.maxTextureSize
    )
      throw new Error('City-reach density texture exceeds this renderer');
    let sharedDensity = densityResources.get(frame.density);
    if (!sharedDensity) {
      sharedDensity = {
        texture: byteTexture(
          frame.density.rgba,
          frame.density.width,
          frame.density.height,
        ),
        references: 0,
      };
      densityResources.set(frame.density, sharedDensity);
    }
    sharedDensity.references += 1;
    const densityResource = sharedDensity;
    releaseDensity = () => {
      densityResource.references -= 1;
      if (!densityResource.references) {
        densityResource.texture.dispose();
        densityResources.delete(frame.density);
      }
    };
    uniforms.uDensity = { value: sharedDensity.texture };
    const paletteWidth = 256;
    const paletteHeight = Math.max(
      1,
      Math.ceil((metadata.cities.length + 1) / paletteWidth),
    );
    const paletteBytes = new Uint8Array(paletteWidth * paletteHeight * 4);
    metadata.cities.forEach((city) => {
      const color = new Color().setHSL(
        (city.id * 0.61803398875) % 1,
        0.32,
        0.62,
      );
      paletteBytes.set(
        [
          Math.round(color.r * 255),
          Math.round(color.g * 255),
          Math.round(color.b * 255),
          255,
        ],
        city.ownerIndex * 4,
      );
    });
    const palette = byteTexture(paletteBytes, paletteWidth, paletteHeight);
    textures.push(palette);
    uniforms.uPalette = { value: palette };
    uniforms.uPaletteSize = { value: [paletteWidth, paletteHeight] };
    material = new ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: fragmentShader(frame.tiles.length),
      depthTest: true,
      depthWrite: false,
    });
    const context = renderer.getContext();
    if (context.isContextLost())
      throw new Error('City-reach renderer context is lost');
    textures.forEach((texture) => renderer.initTexture(texture));
    renderer.initTexture(sharedDensity.texture);
    let shaderFailed = false;
    const previous = renderer.debug.onShaderError;
    const previousChecks = renderer.debug.checkShaderErrors;
    const previousAutoClear = renderer.autoClear;
    const previousViewport = renderer.getViewport(new Vector4());
    const previousScissor = renderer.getScissor(new Vector4());
    const previousScissorTest = renderer.getScissorTest();
    const probeScene = new Scene();
    const probeMesh = new Mesh(surface, material);
    probeMesh.frustumCulled = false;
    probeScene.add(probeMesh);
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = () => {
      shaderFailed = true;
    };
    try {
      // Three checks link status on first use, after compile(). Exercise the
      // screen shader variant without clearing or writing any framebuffer.
      // A render target would compile a different output-colour variant.
      renderer.autoClear = false;
      material.colorWrite = false;
      renderer.setViewport(0, 0, 1, 1);
      renderer.setScissor(0, 0, 1, 1);
      renderer.setScissorTest(true);
      renderer.render(probeScene, camera);
    } finally {
      renderer.debug.onShaderError = previous;
      renderer.debug.checkShaderErrors = previousChecks;
      renderer.autoClear = previousAutoClear;
      material.colorWrite = true;
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
    }
    // Consume the probe's GL error even when link validation already failed.
    // Short-circuiting here would leave INVALID_OPERATION to poison a retry.
    const gpuError = context.getError();
    if (shaderFailed || gpuError !== context.NO_ERROR)
      throw new Error('City-reach GPU upload or shader compilation failed');
    const readyMaterial = material;
    return {
      material: readyMaterial,
      textures,
      dispose() {
        textures.forEach((texture) => texture.dispose());
        releaseDensity();
        readyMaterial.dispose();
      },
    };
  } catch (error) {
    textures.forEach((texture) => texture.dispose());
    releaseDensity();
    material?.dispose();
    throw error;
  }
}

export function CityReachFieldLayer({
  surface,
  metadata,
  frame,
  pendingFrame,
  selectedOwnerIndex,
  commitFrame,
  rejectFrame,
  onRendered,
}: {
  surface: BufferGeometry;
  metadata: CityReachMetadata;
  frame: CityReachFrame | null;
  pendingFrame: CityReachFrame | null;
  selectedOwnerIndex: number | null;
  commitFrame(frame: CityReachFrame): void;
  rejectFrame(frame: CityReachFrame, error: unknown): void;
  onRendered(frame: CityReachFrame): void;
}) {
  const { gl, camera, invalidate } = useThree();
  const resources = useRef(new Map<CityReachFrame, FrameResources>());
  const densityResources = useRef<SharedDensityResources>(new Map());
  const placeholder = useMemo(() => new MeshBasicMaterial(), []);
  const meshRef = useRef<Mesh>(null);
  const rendered = useRef<CityReachFrame | null>(null);
  useLayoutEffect(() => {
    if (!pendingFrame) return;
    try {
      if (!resources.current.has(pendingFrame))
        resources.current.set(
          pendingFrame,
          prepareFrame(
            pendingFrame,
            metadata,
            gl,
            camera,
            surface,
            densityResources.current,
          ),
        );
      commitFrame(pendingFrame);
    } catch (error) {
      rejectFrame(pendingFrame, error);
    }
  }, [camera, commitFrame, gl, metadata, pendingFrame, rejectFrame, surface]);
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (!frame) {
      mesh.visible = false;
      return;
    }
    try {
      let loaded = resources.current.get(frame);
      if (!loaded) {
        loaded = prepareFrame(
          frame,
          metadata,
          gl,
          camera,
          surface,
          densityResources.current,
        );
        resources.current.set(frame, loaded);
      }
      mesh.material = loaded.material;
      mesh.visible = true;
      invalidate();
    } catch (error) {
      mesh.visible = false;
      rejectFrame(frame, error);
    }
  }, [camera, frame, gl, invalidate, metadata, rejectFrame, surface]);
  useEffect(() => {
    for (const [loadedFrame, owned] of resources.current) {
      if (loadedFrame !== frame && loadedFrame !== pendingFrame) {
        owned.dispose();
        resources.current.delete(loadedFrame);
      }
    }
  }, [frame, pendingFrame]);
  useEffect(() => {
    const owned = frame ? resources.current.get(frame) : undefined;
    if (!owned) return;
    owned.material.uniforms.uSelected!.value = selectedOwnerIndex ?? -1;
    invalidate();
  }, [frame, invalidate, selectedOwnerIndex]);
  useEffect(() => {
    const owned = resources.current;
    return () => {
      owned.forEach((entry) => entry.dispose());
      owned.clear();
      placeholder.dispose();
    };
  }, [placeholder]);
  return (
    <mesh
      ref={meshRef}
      geometry={surface}
      material={placeholder}
      visible={false}
      scale={1.004}
      renderOrder={2}
      raycast={ignoreRaycast}
      dispose={null}
      onAfterRender={() => {
        if (frame && rendered.current !== frame) {
          rendered.current = frame;
          onRendered(frame);
        }
      }}
    />
  );
}
