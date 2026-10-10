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
import { forwardPoint, inversePoint } from '../reshaped/reshapedMapping';
import {
  sampleReshapedId,
  type ReshapedDataset,
} from '../reshaped/reshapedData';
import type { InverseField } from '../reshaped/inverseFormat.mjs';
import { ReshapedTransition } from './reshapedTransition';
import {
  RESHAPED_METRIC_BITS,
  type ReshapedMetricId,
} from '../reshaped/metrics';

export interface ReshapedMappingHandle {
  inverse: (point: GeoPoint) => GeoPoint;
  forward: (point: GeoPoint) => GeoPoint;
  unitId: (realPoint: GeoPoint) => string | null;
}

const VERTEX = `out vec3 vGeo; out vec3 vNormal;
void main() { vGeo=position; vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
export const RESHAPED_SAMPLING_GLSL = `float wrapLongitude(float x) { return mod(x+180.0,360.0)-180.0; }
vec2 displacement(sampler2D field, float longitude, float s) {
  ivec2 cells=textureSize(field,0)-1;
  vec2 scaled=vec2((wrapLongitude(longitude)+180.0)/360.0,clamp((s+1.0)*0.5,0.0,1.0))*vec2(cells);
  ivec2 p=min(ivec2(floor(scaled)),cells-1); vec2 f=scaled-vec2(p);
  vec2 a=texelFetch(field,p,0).rg;
  vec2 b=texelFetch(field,p+ivec2(1,0),0).rg;
  vec2 c=texelFetch(field,p+ivec2(0,1),0).rg;
  vec2 d=texelFetch(field,p+ivec2(1,1),0).rg;
  b.x=a.x+wrapLongitude(b.x-a.x); c.x=a.x+wrapLongitude(c.x-a.x); d.x=a.x+wrapLongitude(d.x-a.x);
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float morphLatitude(float a, float b, float t) {
  if(t<=0.0 || a==b) return a; if(t>=1.0) return b;
  float ar=radians(a),br=radians(b);
  float mixedS=mix(sin(ar),sin(br),t);
  if(abs(mixedS)<0.8) return degrees(asin(mixedS));
  bool north=mixedS>=0.0;
  float pole=north?1.5707963267948966:-1.5707963267948966;
  float da=sin((pole-ar)*0.5),db=sin((pole-br)*0.5);
  float distance=sqrt(mix(da*da,db*db,t));
  return degrees(pole+(north?-2.0:2.0)*atan(clamp(distance,0.0,1.0),sqrt(max(0.0,1.0-distance*distance))));
}
float inverseFieldLatitude(sampler2D field, float longitude, float latitude, float s, float deltaS) {
  ivec2 cells=textureSize(field,0)-1;
  float poleDistance=sin(radians((90.0-abs(latitude))*0.5));
  float q=poleDistance*poleDistance;
  float rowsFromPole=q*float(cells.y);
  if(rowsFromPole<1.0) {
    // Preserve 1-|sin(latitude)| before Float32 rounds it away. The pole row
    // has zero sine displacement; interpolate its neighbour by this distance.
    float x=(wrapLongitude(longitude)+180.0)/360.0*float(cells.x);
    int col=min(int(floor(x)),cells.x-1);
    int row=latitude>=0.0?cells.y-1:1;
    float neighbour=mix(texelFetch(field,ivec2(col,row),0).g,texelFetch(field,ivec2(col+1,row),0).g,x-float(col));
    float signPole=latitude>=0.0?1.0:-1.0;
    float sourceQ=clamp(q-signPole*neighbour*rowsFromPole*0.5,0.0,1.0);
    return signPole*(90.0-degrees(2.0*atan(sqrt(sourceQ),sqrt(max(0.0,1.0-sourceQ)))));
  }
  if(deltaS==0.0) return latitude;
  return degrees(asin(clamp(s+deltaS,-1.0,1.0)));
}
vec2 inverseMapping(sampler2D fromField, sampler2D toField, int hasFrom, int hasTo, float longitude, float latitude, float s, float t) {
  vec2 a=hasFrom==1?displacement(fromField,longitude,s):vec2(0.0);
  vec2 b=hasTo==1?displacement(toField,longitude,s):vec2(0.0);
  float fromLatitude=hasFrom==1?inverseFieldLatitude(fromField,longitude,latitude,s,a.y):latitude;
  float toLatitude=hasTo==1?inverseFieldLatitude(toField,longitude,latitude,s,b.y):latitude;
  return vec2(wrapLongitude(longitude+a.x+wrapLongitude(b.x-a.x)*t),morphLatitude(fromLatitude,toLatitude,t));
}
float paddingWeight(int bits, int fromBit, int toBit, float t) {
  float a=(bits & fromBit)!=0?1.0:0.0;
  float b=(bits & toBit)!=0?1.0:0.0;
  return mix(a,b,t);
}
`;
export const RESHAPED_FRAGMENT_SHADER = `
layout(location=0) out highp vec4 reshapedColor;
#define gl_FragColor reshapedColor
uniform sampler2D uFromField; uniform sampler2D uToField; uniform sampler2D uIds; uniform sampler2D uPalette;
uniform int uHasFrom; uniform int uHasTo;
uniform int uFromPaddingBit; uniform int uToPaddingBit;
uniform float uT; uniform int uSelected; uniform vec3 uOcean; uniform vec3 uBorder;
in vec3 vGeo; in vec3 vNormal;
${RESHAPED_SAMPLING_GLSL}
ivec2 countryAt(vec2 uv) {
  ivec2 size=textureSize(uIds,0); ivec2 p=ivec2(floor(vec2(fract(uv.x),clamp(uv.y,0.0,1.0))*vec2(size)));
  p.y=min(p.y,size.y-1); vec2 bytes=floor(texelFetch(uIds,p,0).rg*255.0+0.5);
  return ivec2(bytes);
}
int idAt(vec2 uv) { return countryAt(uv).x; }
vec4 palette(int id) { ivec2 size=textureSize(uPalette,0); return texelFetch(uPalette,ivec2(id%size.x,id/size.x),0); }
void main() {
  vec3 p=normalize(vGeo); float longitude=degrees(atan(p.x,p.z)); float s=p.y; float latitude=degrees(atan(p.y,length(p.xz)));
  vec2 source=inverseMapping(uFromField,uToField,uHasFrom,uHasTo,longitude,latitude,s,uT);
  vec2 uv=vec2((source.x+180.0)/360.0,(90.0-source.y)/180.0);
  ivec2 country=countryAt(uv); int id=country.x;
  vec4 info=palette(id); vec3 color=id==0?uOcean:info.rgb;
  float padding=id==0?0.0:paddingWeight(country.y,uFromPaddingBit,uToPaddingBit,uT);
  // The displayed sphere supplies the stripe coordinates, so hatching rotates
  // with the globe and remains independent of screen-space position.
  float phase=dot(p,vec3(1.0,1.0,0.35))*90.0;
  float distance=abs(fract(phase)-0.5);
  float aa=max(fwidth(phase),0.001);
  float stripe=1.0-smoothstep(0.10-aa,0.10+aa,distance);
  float grey=dot(color,vec3(0.2126,0.7152,0.0722));
  vec3 paddingColor=mix(vec3(grey),color,0.30);
  paddingColor=mix(paddingColor,vec3(0.18,0.13,0.09),stripe*0.65);
  color=mix(color,paddingColor,padding);
  vec2 dx=dFdx(uv),dy=dFdy(uv); // Derivatives follow the real position on screen.
  if(abs(dx.x)>0.5) dx.x=dx.x-sign(dx.x); if(abs(dy.x)>0.5) dy.x=dy.x-sign(dy.x);
  int nearX=idAt(uv+dx*0.7),nearY=idAt(uv+dy*0.7);
  bool unitEdge=nearX!=id || nearY!=id;
  if(unitEdge) color=mix(color,uBorder,0.72);
  if(id!=0 && id==uSelected) color=mix(color,vec3(0.58,0.25,0.12),0.55);
  float light=0.70+0.30*max(dot(normalize(vNormal),normalize(vec3(-0.4,0.7,1.0))),0.0);
  gl_FragColor=vec4(color*light,1.0);
  #include <colorspace_fragment>
}`;

function fieldTexture(field: InverseField): DataTexture {
  const texture = new DataTexture(
    field.data,
    field.width + 1,
    field.height + 1,
    RGFormat,
    FloatType,
  );
  texture.internalFormat = 'RG32F';
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
function idResources(data: Pick<ReshapedDataset, 'ids' | 'units'>) {
  const raster = data.ids!;
  const { width, height, ids } = raster;
  const bytes = new Uint8Array(width * height * 2);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x,
        id = ids[i]!;
      if (id > 255)
        throw new Error(
          'Reshaped Earth unit ID exceeds the lossless GPU encoding',
        );
      bytes[i * 2] = id;
      bytes[i * 2 + 1] = raster.padding?.[i] ?? 0;
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
  const maxId = Math.max(0, ...data.units.map((u) => u.rasterId));
  const paletteWidth = 256,
    paletteHeight = Math.ceil((maxId + 1) / paletteWidth);
  const paletteBytes = new Float32Array(paletteWidth * paletteHeight * 4);
  for (const unit of data.units) {
    const color = new Color(COUNTRY_TEXTURE_STYLE.landColor),
      at = unit.rasterId * 4;
    paletteBytes[at] = color.r;
    paletteBytes[at + 1] = color.g;
    paletteBytes[at + 2] = color.b;
    paletteBytes[at + 3] = 1;
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

function syncTransitionUniforms(
  transition: ReshapedTransition<DataTexture>,
  material: ShaderMaterial,
) {
  const { mapping } = transition;
  const from = transition.textureFor(mapping.from);
  const to = transition.textureFor(mapping.to);
  material.uniforms.uFromField!.value = from ?? to;
  material.uniforms.uToField!.value = to ?? from;
  material.uniforms.uHasFrom!.value = from ? 1 : 0;
  material.uniforms.uHasTo!.value = to ? 1 : 0;
  material.uniforms.uT!.value = mapping.t;
  material.uniforms.uFromPaddingBit!.value = transition.fromMetric
    ? 1 << RESHAPED_METRIC_BITS[transition.fromMetric as ReshapedMetricId]
    : 0;
  material.uniforms.uToPaddingBit!.value = transition.toMetric
    ? 1 << RESHAPED_METRIC_BITS[transition.toMetric as ReshapedMetricId]
    : 0;
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
  const requestedMetric = useAppStore((state) => state.reshapedMetric);
  const transition = useMemo(
    () => new ReshapedTransition(fieldTexture, (texture) => texture.dispose()),
    [],
  );
  const marker = useRef<Mesh>(null);
  const shader = useRef<ShaderMaterial>(null);
  const { ids, units } = data;
  const resources = useMemo(() => idResources({ ids, units }), [ids, units]);
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
          uFromField: { value: null },
          uToField: { value: null },
          uHasFrom: { value: 0 },
          uHasTo: { value: 0 },
          uFromPaddingBit: { value: 0 },
          uToPaddingBit: { value: 0 },
          uIds: { value: resources.texture },
          uPalette: { value: resources.palette },
          uT: { value: 1 },
          uSelected: { value: 0 },
          uOcean: { value: new Color(COUNTRY_TEXTURE_STYLE.oceanColor) },
          uBorder: { value: new Color(COUNTRY_VECTOR_BORDER_COLOR) },
        },
      }),
    [resources],
  );
  useEffect(() => {
    shader.current = material;
    transition.sync(
      data.inverse!,
      shape,
      requestedMetric,
      replayKey,
      reducedMotion,
      performance.now(),
      data.metric,
    );
    syncTransitionUniforms(transition, material);
    setMorphState(transition.active ? 'animating' : 'settled');
    invalidate();
  }, [
    data.inverse,
    data.metric,
    shape,
    replayKey,
    reducedMotion,
    requestedMetric,
    transition,
    material,
    invalidate,
    setMorphState,
  ]);
  useEffect(() => {
    mappingRef.current = {
      inverse: (p) => inversePoint(p, transition.mapping),
      forward: (p) => forwardPoint(p, transition.mapping),
      unitId: (p) =>
        data.unitsByRasterId.get(
          sampleReshapedId(resources.raster, p.latitude, p.longitude),
        )?.id ?? null,
    };
    return () => {
      mappingRef.current = null;
    };
  }, [data, mappingRef, resources, transition]);
  useEffect(
    () => () => {
      resources.texture.dispose();
      resources.palette.dispose();
      material.dispose();
    },
    [resources, material],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => transition.dispose(), [transition]);
  useFrame(() => {
    const currentShader = shader.current;
    if (!currentShader) return;
    if (transition.active) {
      transition.tick(performance.now());
      syncTransitionUniforms(transition, currentShader);
      if (transition.active) invalidate();
      else setMorphState('settled');
    }
    const selected = selectedOverride
      ? data.unitsById.get(selectedOverride)?.rasterId
      : sampleReshapedId(resources.raster, point.latitude, point.longitude);
    currentShader.uniforms.uSelected!.value = selected ?? 0;
    if (marker.current)
      marker.current.position.copy(
        geoToVector3(forwardPoint(point, transition.mapping), 1.012),
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
