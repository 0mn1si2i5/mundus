import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import {
  Color,
  DataTexture,
  FloatType,
  GLSL3,
  NearestFilter,
  RGBAFormat,
  RGFormat,
  RedIntegerFormat,
  RGBAIntegerFormat,
  ShortType,
  UnsignedIntType,
  Vector2,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
} from 'three';
import type { Mesh } from 'three';
import { useAppStore } from '../../state/appStore';
import type { GeoPoint } from './geo';
import { geoToVector3 } from './geo';
import {
  COUNTRY_TEXTURE_STYLE,
  COUNTRY_VECTOR_BORDER_COLOR,
} from './countryData';
import type { QualityProfile } from './quality';
import { useReducedMotion } from './useReducedMotion';
import { ignoreRaycast } from './sceneUtils';
import {
  forwardPoint,
  inversePoint,
  MORPH_DURATION_MS,
  type MorphMapping,
} from '../reshaped/reshapedMapping';
import {
  sampleReshapedId,
  type ReshapedDataset,
} from '../reshaped/reshapedData';
import type { InverseField } from '../reshaped/inverseFormat.mjs';

export interface ReshapedMappingHandle {
  inverse: (point: GeoPoint) => GeoPoint;
  forward: (point: GeoPoint) => GeoPoint;
  unitId: (realPoint: GeoPoint) => string | null;
}

const VERTEX = `out vec3 vGeo; out vec3 vNormal;
void main() { vGeo=position; vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
export const RESHAPED_SAMPLING_GLSL = `float wrapLongitude(float x) { return mod(x+180.0,360.0)-180.0; }
int wrapX(int x,int width) { return (x%width+width)%width; }
vec2 displacement(sampler2D field, float longitude, float s) {
  ivec2 size=textureSize(field,0);
  float fx=(wrapLongitude(longitude)+180.0)/360.0*float(size.x)-0.5;
  float fy=clamp((s+1.0)*0.5*float(size.y)-0.5,0.0,float(size.y-1));
  ivec2 p=ivec2(floor(fx),floor(fy)); vec2 f=vec2(fract(fx),fract(fy));
  vec2 a=texelFetch(field,ivec2(wrapX(p.x,size.x),p.y),0).rg;
  vec2 b=texelFetch(field,ivec2(wrapX(p.x+1,size.x),p.y),0).rg;
  vec2 c=texelFetch(field,ivec2(wrapX(p.x,size.x),min(p.y+1,size.y-1)),0).rg;
  vec2 d=texelFetch(field,ivec2(wrapX(p.x+1,size.x),min(p.y+1,size.y-1)),0).rg;
  b.x=a.x+wrapLongitude(b.x-a.x); c.x=a.x+wrapLongitude(c.x-a.x); d.x=a.x+wrapLongitude(d.x-a.x);
  vec2 result=mix(mix(a,b,f.x),mix(c,d,f.x),f.y); result.y*=clamp((1.0-abs(s))*float(size.y),0.0,1.0); return result;
}
vec2 adaptiveDisplacement(usampler2D tree, isampler2D corners, ivec2 rootSize, vec2 steps, float longitude, float s, float latitude, bool latitudeAxis) {
  vec2 scaled=vec2((wrapLongitude(longitude)+180.0)/360.0,(latitudeAxis ? (latitude+90.0)/180.0 : (s+1.0)*0.5))*vec2(rootSize);
  ivec2 root=min(ivec2(floor(scaled)),rootSize-1);
  vec2 local=scaled-vec2(root);
  uint node=uint(root.y*rootSize.x+root.x),leaf=0u;
  int treeWidth=textureSize(tree,0).x;
  for(int depth=0;depth<=8;depth++) {
    uint word=texelFetch(tree,ivec2(int(node)%treeWidth,int(node)/treeWidth),0).r;
    if((word&0x80000000u)!=0u) { leaf=word&0x7fffffffu; break; }
    ivec2 quadrant=min(ivec2(floor(local*2.0)),ivec2(1));
    node=word+uint(quadrant.y*2+quadrant.x); local=local*2.0-vec2(quadrant);
  }
  int width=textureSize(corners,0).x,at=int(leaf)*2;
  vec4 first=vec4(texelFetch(corners,ivec2(at%width,at/width),0))*steps.xyxy;
  vec4 second=vec4(texelFetch(corners,ivec2((at+1)%width,(at+1)/width),0))*steps.xyxy;
  vec2 a=first.xy,b=first.zw,c=second.xy,d=second.zw;
  b.x=a.x+wrapLongitude(b.x-a.x); c.x=a.x+wrapLongitude(c.x-a.x); d.x=a.x+wrapLongitude(d.x-a.x);
  return mix(mix(a,b,local.x),mix(c,d,local.x),local.y);
}
float morphLatitude(float a, float b, float t) {
  if(t<=0.0) return a; if(t>=1.0) return b;
  float ar=radians(a),br=radians(b);
  float mixedS=mix(sin(ar),sin(br),t);
  if(abs(mixedS)<0.8) return degrees(asin(mixedS));
  bool north=mixedS>=0.0;
  float pole=north?1.5707963267948966:-1.5707963267948966;
  float da=sin((pole-ar)*0.5),db=sin((pole-br)*0.5);
  float distance=sqrt(mix(da*da,db*db,t));
  return degrees(pole+(north?-2.0:2.0)*atan(clamp(distance,0.0,1.0),sqrt(max(0.0,1.0-distance*distance))));
}
`;
export const RESHAPED_FRAGMENT_SHADER = `
layout(location=0) out highp vec4 reshapedColor;
#define gl_FragColor reshapedColor
uniform sampler2D uFrom; uniform sampler2D uTo; uniform sampler2D uIds; uniform sampler2D uPalette;
uniform usampler2D uFromTree; uniform usampler2D uToTree;
uniform isampler2D uFromCorners; uniform isampler2D uToCorners;
uniform bool uFromAdaptive; uniform bool uToAdaptive;
uniform bool uFromLatitude; uniform bool uToLatitude;
uniform ivec2 uFromRoot; uniform ivec2 uToRoot;
uniform vec2 uFromSteps; uniform vec2 uToSteps;
uniform float uT; uniform int uSelected; uniform vec3 uOcean; uniform vec3 uBorder;
in vec3 vGeo; in vec3 vNormal;
${RESHAPED_SAMPLING_GLSL}
int idAt(vec2 uv) {
  ivec2 size=textureSize(uIds,0); ivec2 p=ivec2(floor(vec2(fract(uv.x),clamp(uv.y,0.0,1.0))*vec2(size)));
  p.y=min(p.y,size.y-1); vec2 bytes=floor(texelFetch(uIds,p,0).rg*255.0+0.5);
  return int(bytes.x*256.0+bytes.y);
}
vec4 palette(int id) { ivec2 size=textureSize(uPalette,0); return texelFetch(uPalette,ivec2(id%size.x,id/size.x),0); }
void main() {
  vec3 p=normalize(vGeo); float longitude=degrees(atan(p.x,p.z)); float s=p.y; float latitude=degrees(atan(p.y,length(p.xz)));
  vec2 a=uFromAdaptive?adaptiveDisplacement(uFromTree,uFromCorners,uFromRoot,uFromSteps,longitude,s,latitude,uFromLatitude):displacement(uFrom,longitude,s);
  vec2 b=uToAdaptive?adaptiveDisplacement(uToTree,uToCorners,uToRoot,uToSteps,longitude,s,latitude,uToLatitude):displacement(uTo,longitude,s);
  float fromLatitude=uFromLatitude?clamp(latitude+a.y,-90.0,90.0):degrees(asin(clamp(s+a.y,-1.0,1.0)));
  float toLatitude=uToLatitude?clamp(latitude+b.y,-90.0,90.0):degrees(asin(clamp(s+b.y,-1.0,1.0)));
  float sourceLatitude=morphLatitude(fromLatitude,toLatitude,uT);
  float deltaLongitude=a.x+wrapLongitude(b.x-a.x)*uT;
  vec2 uv=vec2((wrapLongitude(longitude+deltaLongitude)+180.0)/360.0,(90.0-sourceLatitude)/180.0);
  int id=idAt(uv); vec4 info=palette(id); vec3 color=id==0?uOcean:info.rgb;
  vec2 dx=dFdx(uv),dy=dFdy(uv); // Derivatives follow the real position on screen.
  if(abs(dx.x)>0.5) dx.x=dx.x-sign(dx.x); if(abs(dy.x)>0.5) dy.x=dy.x-sign(dy.x);
  int nearX=idAt(uv+dx*0.7),nearY=idAt(uv+dy*0.7);
  bool countryEdge=abs(palette(nearX).a-info.a)>0.001 || abs(palette(nearY).a-info.a)>0.001;
  bool unitEdge=nearX!=id || nearY!=id;
  if(unitEdge) color=mix(color,uBorder,countryEdge?0.72:0.28);
  if(id!=0 && id==uSelected) color=mix(color,vec3(0.58,0.25,0.12),0.55);
  float light=0.70+0.30*max(dot(normalize(vNormal),normalize(vec3(-0.4,0.7,1.0))),0.0);
  gl_FragColor=vec4(color*light,1.0);
  #include <colorspace_fragment>
}`;

interface FieldTextures {
  field: DataTexture;
  tree: DataTexture;
  corners: DataTexture;
  adaptive: boolean;
  latitude: boolean;
  root: Vector2;
  steps: Vector2;
  dispose: () => void;
}
function fieldTexture(field: InverseField | null): FieldTextures {
  const adaptive = field?.encoding === 'adaptive-quadtree-int16';
  const regular = new DataTexture(
    adaptive ? new Float32Array(2) : (field?.data ?? new Float32Array(2)),
    adaptive ? 1 : (field?.width ?? 1),
    adaptive ? 1 : (field?.height ?? 1),
    RGFormat,
    FloatType,
  );
  regular.internalFormat = 'RG32F';
  const textureWidth = adaptive ? 1024 : 1;
  const nodes = adaptive ? field.tree! : new Uint32Array([0x80000000]);
  const treeHeight = Math.ceil(nodes.length / textureWidth);
  const treeBytes = new Uint32Array(textureWidth * treeHeight);
  treeBytes.set(nodes);
  const tree = new DataTexture(
    treeBytes,
    textureWidth,
    treeHeight,
    RedIntegerFormat,
    UnsignedIntType,
  );
  tree.internalFormat = 'R32UI';
  const values = adaptive ? field.corners! : new Int16Array(8);
  const cornerHeight = Math.ceil(values.length / (4 * textureWidth));
  const cornerBytes = new Int16Array(textureWidth * cornerHeight * 4);
  cornerBytes.set(values);
  const corners = new DataTexture(
    cornerBytes,
    textureWidth,
    cornerHeight,
    RGBAIntegerFormat,
    ShortType,
  );
  corners.internalFormat = 'RGBA16I';
  for (const texture of [regular, tree, corners]) {
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  }
  return {
    field: regular,
    tree,
    corners,
    adaptive,
    latitude: field?.header?.verticalCoordinate === 'latitude',
    root: new Vector2(field?.width ?? 1, field?.height ?? 1),
    steps: new Vector2(
      field?.header?.stepLongitude ?? 1,
      field?.header?.stepLatitude ?? field?.header?.stepS ?? 1,
    ),
    dispose: () => {
      regular.dispose();
      tree.dispose();
      corners.dispose();
    },
  };
}
function idResources(data: ReshapedDataset) {
  const raster = data.ids!;
  const { width, height, ids } = raster;
  const bytes = new Uint8Array(width * height * 2);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x,
        id = ids[i]!;
      if (id > 65535)
        throw new Error(
          'Reshaped Earth unit ID exceeds the lossless GPU encoding',
        );
      bytes[i * 2] = (id >>> 8) & 255;
      bytes[i * 2 + 1] = id & 255;
    }
  // Two bytes preserve every current ID and keep GPU use below 40 MB while
  // the distributed PNG remains RGB8 and never passes through colour APIs.
  const texture = new DataTexture(
    bytes,
    width,
    height,
    RGFormat,
    UnsignedByteType,
  );
  texture.internalFormat = 'RG8';
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const maxId = Math.max(
    0,
    ...data.units.filter((u) => u.level === data.level).map((u) => u.rasterId),
  );
  const paletteWidth = 256,
    paletteHeight = Math.ceil((maxId + 1) / paletteWidth);
  const paletteBytes = new Float32Array(paletteWidth * paletteHeight * 4);
  const parentIds = [
    ...new Set(
      data.units
        .filter((u) => u.level === data.level)
        .map((u) => u.parentCountryId),
    ),
  ].sort();
  for (const unit of data.units.filter((u) => u.level === data.level)) {
    const color = new Color(COUNTRY_TEXTURE_STYLE.landColor),
      at = unit.rasterId * 4;
    paletteBytes[at] = color.r;
    paletteBytes[at + 1] = color.g;
    paletteBytes[at + 2] = color.b;
    paletteBytes[at + 3] =
      (parentIds.indexOf(unit.parentCountryId) + 1) / (parentIds.length + 1);
  }
  const palette = new DataTexture(
    paletteBytes,
    paletteWidth,
    paletteHeight,
    RGBAFormat,
    FloatType,
  );
  palette.minFilter = NearestFilter;
  palette.magFilter = NearestFilter;
  palette.generateMipmaps = false;
  palette.needsUpdate = true;
  return {
    texture,
    palette,
    raster,
  };
}

export function ReshapedLayer({
  profile,
  shape,
  data,
  replayKey,
  mappingRef,
}: {
  profile: QualityProfile;
  shape: 'true' | 'reshaped';
  data: ReshapedDataset;
  replayKey: number;
  mappingRef: MutableRefObject<ReshapedMappingHandle | null>;
}) {
  const { invalidate } = useThree();
  const reducedMotion = useReducedMotion();
  const point = useAppStore((state) => state.point);
  const selectedOverride = useAppStore((state) => state.reshapedSelectedUnitId);
  const setMorphState = useAppStore((state) => state.setReshapedMorphState);
  const mapping = useRef<MorphMapping>({ from: null, to: null, t: 1 });
  const animation = useRef({ startedAt: 0, active: false });
  const lastReplay = useRef(replayKey);
  const textures = useRef<{ from: FieldTextures; to: FieldTextures } | null>(
    null,
  );
  const marker = useRef<Mesh>(null);
  const shader = useRef<ShaderMaterial>(null);
  const resources = useMemo(() => idResources(data), [data]);
  const geometry = useMemo(
    () => new SphereGeometry(1.002, ...profile.sphereSegments),
    [profile.sphereSegments],
  );
  const material = useMemo(
    () =>
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: RESHAPED_FRAGMENT_SHADER,
        uniforms: {
          uFrom: { value: null },
          uTo: { value: null },
          uIds: { value: resources.texture },
          uPalette: { value: resources.palette },
          uFromTree: { value: null },
          uToTree: { value: null },
          uFromCorners: { value: null },
          uToCorners: { value: null },
          uFromAdaptive: { value: false },
          uToAdaptive: { value: false },
          uFromLatitude: { value: false },
          uToLatitude: { value: false },
          uFromRoot: { value: new Vector2(1, 1) },
          uToRoot: { value: new Vector2(1, 1) },
          uFromSteps: { value: new Vector2(1, 1) },
          uToSteps: { value: new Vector2(1, 1) },
          uT: { value: 1 },
          uSelected: { value: 0 },
          uOcean: { value: new Color(COUNTRY_TEXTURE_STYLE.oceanColor) },
          uBorder: { value: new Color(COUNTRY_VECTOR_BORDER_COLOR) },
        },
      }),
    [resources],
  );
  useEffect(() => {
    const replay = lastReplay.current !== replayKey;
    lastReplay.current = replayKey;
    const next = shape === 'reshaped' ? data.inverse : null;
    const from = replay ? null : mapping.current.to;
    mapping.current = { from, to: next, t: reducedMotion ? 1 : 0 };
    textures.current?.from.dispose();
    textures.current?.to.dispose();
    textures.current = { from: fieldTexture(from), to: fieldTexture(next) };
    shader.current = material;
    for (const [prefix, resource] of [
      ['From', textures.current.from],
      ['To', textures.current.to],
    ] as const) {
      shader.current.uniforms[`u${prefix}`]!.value = resource.field;
      shader.current.uniforms[`u${prefix}Tree`]!.value = resource.tree;
      shader.current.uniforms[`u${prefix}Corners`]!.value = resource.corners;
      shader.current.uniforms[`u${prefix}Adaptive`]!.value = resource.adaptive;
      shader.current.uniforms[`u${prefix}Latitude`]!.value = resource.latitude;
      shader.current.uniforms[`u${prefix}Root`]!.value = resource.root;
      shader.current.uniforms[`u${prefix}Steps`]!.value = resource.steps;
    }
    shader.current.uniforms.uT!.value = mapping.current.t;
    animation.current = {
      startedAt: performance.now(),
      active: !reducedMotion,
    };
    setMorphState(reducedMotion ? 'settled' : 'animating');
    invalidate();
  }, [
    data.inverse,
    shape,
    replayKey,
    reducedMotion,
    material,
    invalidate,
    setMorphState,
  ]);
  useEffect(() => {
    mappingRef.current = {
      inverse: (p) => inversePoint(p, mapping.current),
      forward: (p) => forwardPoint(p, mapping.current),
      unitId: (p) =>
        data.unitsByRasterId.get(
          sampleReshapedId(resources.raster, p.latitude, p.longitude),
        )?.id ?? null,
    };
    return () => {
      mappingRef.current = null;
    };
  }, [data, mappingRef, resources]);
  useEffect(
    () => () => {
      resources.texture.dispose();
      resources.palette.dispose();
      material.dispose();
    },
    [resources, material],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(
    () => () => {
      animation.current.active = false;
      textures.current?.from.dispose();
      textures.current?.to.dispose();
      textures.current = null;
    },
    [],
  );
  useFrame(() => {
    if (!shader.current) return;
    if (animation.current.active) {
      const elapsed = Math.min(
        1,
        (performance.now() - animation.current.startedAt) / MORPH_DURATION_MS,
      );
      mapping.current.t = elapsed * elapsed * (3 - 2 * elapsed);
      shader.current.uniforms.uT!.value = mapping.current.t;
      if (elapsed === 1) {
        animation.current.active = false;
        setMorphState('settled');
      } else invalidate();
    }
    const selected = selectedOverride
      ? data.unitsById.get(selectedOverride)?.rasterId
      : sampleReshapedId(resources.raster, point.latitude, point.longitude);
    shader.current.uniforms.uSelected!.value = selected ?? 0;
    if (marker.current)
      marker.current.position.copy(
        geoToVector3(forwardPoint(point, mapping.current), 1.012),
      );
  });
  return (
    <>
      <mesh geometry={geometry} material={material} raycast={ignoreRaycast} />
      <mesh ref={marker} raycast={ignoreRaycast}>
        <sphereGeometry args={[0.007, 12, 8]} />
        <meshBasicMaterial color="#7f2f24" />
      </mesh>
    </>
  );
}
