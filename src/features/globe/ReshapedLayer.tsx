import { useFrame, useThree } from '@react-three/fiber';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  Color,
  DataTexture,
  FloatType,
  GLSL3,
  NearestFilter,
  RedFormat,
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
import { ReshapedThemeTransition } from './reshapedThemeTransition';
import {
  RESHAPED_METRIC_BITS,
  RESHAPED_METRIC_THEMES,
  RESHAPED_METRICS,
  areaRatioBand,
  type ReshapedMetricId,
} from '../reshaped/metrics';

const THEME_COLORS = Object.fromEntries(
  RESHAPED_METRICS.map(({ id }) => [
    id,
    {
      ocean: new Color(RESHAPED_METRIC_THEMES[id].ocean),
      border: new Color(RESHAPED_METRIC_THEMES[id].border),
      borderLight: new Color(RESHAPED_METRIC_THEMES[id].borderLight),
      selection: new Color(RESHAPED_METRIC_THEMES[id].selection),
    },
  ]),
) as Record<
  ReshapedMetricId,
  { ocean: Color; border: Color; borderLight: Color; selection: Color }
>;

export interface ReshapedMappingHandle {
  inverse: (point: GeoPoint) => GeoPoint;
  forward: (point: GeoPoint) => GeoPoint;
  unitId: (realPoint: GeoPoint) => string | null;
  theme: () => ReshapedThemeTransition;
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
export const RESHAPED_LABEL_GLSL = `// Return id, signed distance in raster pixels, padding bits, and whether
// all four texels are a single label with a saturated distance lower bound.
uniform float uDistanceCap;
vec4 classify(vec2 uv) {
  ivec2 size=textureSize(uIds,0);
  vec2 scaled=vec2(fract(uv.x),clamp(uv.y,0.0,1.0))*vec2(size)-0.5;
  ivec2 base=ivec2(floor(scaled)); vec2 f=fract(scaled);
  int ids[4]; int bits[4]; float distances[4]; float weights[4];
  for(int j=0;j<2;j++) for(int i=0;i<2;i++) {
    int k=j*2+i; int x=(base.x+i)%size.x; if(x<0)x+=size.x;
    int y=clamp(base.y+j,0,size.y-1); ivec2 p=ivec2(x,y);
    vec2 packed=floor(texelFetch(uIds,p,0).rg*255.0+0.5);
    ids[k]=int(packed.x); bits[k]=int(packed.y);
    // Compare exact quantized bytes; normalize only the winning score. UNORM
    // rounding per texel otherwise changes which label wins an exact tie.
    distances[k]=floor(texelFetch(uDistances,p,0).r*255.0+0.5);
    weights[k]=((i==0)?1.0-f.x:f.x)*((j==0)?1.0-f.y:f.y);
  }
  int bestId=ids[0]; float best=-1000.0; int bestBits=0;
  for(int c=0;c<4;c++) {
    float score=0.0; float closestWeight=-1.0; int candidateBits=0;
    for(int k=0;k<4;k++) {
      score += weights[k]*(ids[k]==ids[c] ? distances[k] : -distances[k]);
      if(ids[k]==ids[c] && weights[k]>closestWeight) {closestWeight=weights[k];candidateBits=bits[k];}
    }
    if(score>best) { best=score; bestId=ids[c]; bestBits=candidateBits; }
  }
  bool cappedInterior=true;
  for(int k=0;k<4;k++) if(ids[k]!=bestId || distances[k]<uDistanceCap) cappedInterior=false;
  return vec4(float(bestId),best*4.0/255.0,float(bestBits),cappedInterior?1.0:0.0);
}`;

export const RESHAPED_FRAGMENT_SHADER = `
layout(location=0) out highp vec4 reshapedColor;
#define gl_FragColor reshapedColor
uniform sampler2D uFromField; uniform sampler2D uToField; uniform sampler2D uIds; uniform sampler2D uDistances; uniform sampler2D uPalette;
uniform int uHasFrom; uniform int uHasTo;
uniform int uFromPaddingBit; uniform int uToPaddingBit;
uniform int uFromMetricIndex; uniform int uToMetricIndex;
uniform float uT; uniform float uThemeT; uniform int uSelected; uniform vec3 uOcean; uniform vec3 uBorder; uniform vec3 uBorderLight; uniform vec3 uSelection;
uniform float uAmbient; uniform float uDirectional;
in vec3 vGeo; in vec3 vNormal;
${RESHAPED_SAMPLING_GLSL}

${RESHAPED_LABEL_GLSL}

vec3 palette(int metricIndex,int id) {
  ivec2 size=textureSize(uPalette,0);
  return texelFetch(uPalette,ivec2(clamp(id,0,size.x-1),clamp(metricIndex,0,size.y-1)),0).rgb;
}
vec4 shadeAt(vec2 uv, vec3 p, float footprint) {
  vec4 label=classify(uv); int id=int(label.x+0.5);
  vec3 color=id==0?uOcean:mix(palette(uFromMetricIndex,id),palette(uToMetricIndex,id),uThemeT);
  float padding=id==0?0.0:paddingWeight(int(label.z+0.5),uFromPaddingBit,uToPaddingBit,uT);
  float phase=dot(p,vec3(1.0,1.0,0.35))*90.0;
  float stripeDistance=abs(fract(phase)-0.5); float stripeAa=max(fwidth(phase),0.001);
  float stripe=1.0-smoothstep(0.10-stripeAa,0.10+stripeAa,stripeDistance);
  float grey=dot(color,vec3(0.2126,0.7152,0.0722));
  vec3 paddingColor=mix(vec3(grey),color,0.30);
  paddingColor=mix(paddingColor,vec3(1.0),0.15);
  paddingColor=mix(paddingColor,vec3(0.18,0.13,0.09),stripe*0.65);
  color=mix(color,paddingColor,padding);
  float px=label.y/max(footprint,0.0001);
  // Saturated B means distance >= its cap, not distance = its cap. Painting it
  // as a real edge floods small globes with border ink at large footprints.
  float border=label.w>0.5?0.0:1.0-smoothstep(0.1,1.1,px);
  // Choose contrasting ink on each side of a shared boundary. A single ink
  // cannot meet 3:1 against both the darkest and brightest palette entries.
  vec3 borderInk=dot(color,vec3(0.2126,0.7152,0.0722))<0.179?uBorderLight:uBorder;
  color=mix(color,borderInk,border);
  if(id!=0 && id==uSelected && label.w<0.5) color=mix(color,uSelection,1.0-smoothstep(2.5,3.5,px));
  return vec4(color,border);
}
void main() {
  vec3 p=normalize(vGeo); float longitude=degrees(atan(p.x,p.z)); float s=p.y; float latitude=degrees(atan(p.y,length(p.xz)));
  vec2 source=inverseMapping(uFromField,uToField,uHasFrom,uHasTo,longitude,latitude,s,uT);
  vec2 uv=vec2((source.x+180.0)/360.0,(90.0-source.y)/180.0);
  vec2 dx=dFdx(uv),dy=dFdy(uv); if(abs(dx.x)>0.5)dx.x-=sign(dx.x); if(abs(dy.x)>0.5)dy.x-=sign(dy.x);
  vec2 texelSize=vec2(textureSize(uIds,0)); float footprint=max(length(dx*texelSize),length(dy*texelSize));
  vec3 color;
  if(footprint>1.0) {
    vec2 offsets[4]=vec2[4](vec2(-0.375,-0.125),vec2(0.125,-0.375),vec2(0.375,0.125),vec2(-0.125,0.375));
    color=vec3(0.0); for(int i=0;i<4;i++) color+=shadeAt(uv+dx*offsets[i].x+dy*offsets[i].y,p,footprint).rgb; color*=0.25;
  } else color=shadeAt(uv,p,footprint).rgb;
  float light=uAmbient+uDirectional*max(dot(normalize(vNormal),normalize(vec3(-0.4,0.7,1.0))),0.0);
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
function idResources(data: Pick<ReshapedDataset, 'ids' | 'units' | 'values'>) {
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
  const distanceBytes = raster.distance ?? new Uint8Array(width * height);
  const distances = new DataTexture(
    distanceBytes,
    width,
    height,
    RedFormat,
    UnsignedByteType,
  );
  distances.internalFormat = 'R8';
  distances.minFilter = NearestFilter;
  distances.magFilter = NearestFilter;
  distances.generateMipmaps = false;
  distances.needsUpdate = true;
  const paletteWidth = 256,
    paletteHeight = RESHAPED_METRICS.length;
  const paletteBytes = new Float32Array(paletteWidth * paletteHeight * 4);
  const valuesById = new Map(
    [...data.values.values()].map((value) => [value.id, value]),
  );
  for (
    let metricIndex = 0;
    metricIndex < RESHAPED_METRICS.length;
    metricIndex++
  ) {
    const metric = RESHAPED_METRICS[metricIndex]!;
    const theme = RESHAPED_METRIC_THEMES[metric.id];
    for (const unit of data.units) {
      const value = valuesById.get(unit.id)?.areaRatio[metric.id] ?? null;
      const band = unit.excluded ? -1 : areaRatioBand(value);
      const color = new Color(
        band < 0
          ? unit.excluded
            ? '#d4d0c5'
            : '#a9a7a0'
          : theme.palette[band]!,
      );
      const at = (metricIndex * paletteWidth + unit.rasterId) * 4;
      paletteBytes[at] = color.r;
      paletteBytes[at + 1] = color.g;
      paletteBytes[at + 2] = color.b;
      paletteBytes[at + 3] = 1;
    }
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
    distances,
    distanceCap: raster.distanceCap ?? 255,
    palette,
    raster,
  };
}

function syncTransitionUniforms(
  transition: ReshapedTransition<DataTexture>,
  material: ShaderMaterial,
  theme: ReshapedThemeTransition,
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
  const fromMetric =
    (theme.from as ReshapedMetricId | null) ??
    (theme.to as ReshapedMetricId | null) ??
    'population';
  const toMetric = (theme.to as ReshapedMetricId | null) ?? fromMetric;
  const fromIndex = Math.max(
    0,
    RESHAPED_METRICS.findIndex((metric) => metric.id === fromMetric),
  );
  const toIndex = Math.max(
    0,
    RESHAPED_METRICS.findIndex((metric) => metric.id === toMetric),
  );
  material.uniforms.uThemeT!.value = theme.t;
  const fromTheme = RESHAPED_METRIC_THEMES[fromMetric];
  const toTheme = RESHAPED_METRIC_THEMES[toMetric];
  material.uniforms.uFromMetricIndex!.value = fromIndex;
  material.uniforms.uToMetricIndex!.value = toIndex;
  material.uniforms
    .uOcean!.value.copy(THEME_COLORS[fromMetric].ocean)
    .lerp(THEME_COLORS[toMetric].ocean, theme.t);
  material.uniforms
    .uBorder!.value.copy(THEME_COLORS[fromMetric].border)
    .lerp(THEME_COLORS[toMetric].border, theme.t);
  material.uniforms
    .uBorderLight!.value.copy(THEME_COLORS[fromMetric].borderLight)
    .lerp(THEME_COLORS[toMetric].borderLight, theme.t);
  material.uniforms
    .uSelection!.value.copy(THEME_COLORS[fromMetric].selection)
    .lerp(THEME_COLORS[toMetric].selection, theme.t);
  material.uniforms.uAmbient!.value =
    fromTheme.light.ambient +
    (toTheme.light.ambient - fromTheme.light.ambient) * theme.t;
  material.uniforms.uDirectional!.value =
    fromTheme.light.directional +
    (toTheme.light.directional - fromTheme.light.directional) * theme.t;
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
  const [theme] = useState(() => new ReshapedThemeTransition(data.metric));
  const marker = useRef<Mesh>(null);
  const shader = useRef<ShaderMaterial>(null);
  const { ids, units, values } = data;
  const resources = useMemo(
    () => idResources({ ids, units, values }),
    [ids, units, values],
  );
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
          uDistances: { value: resources.distances },
          uDistanceCap: { value: resources.distanceCap },
          uPalette: { value: resources.palette },
          uT: { value: 1 },
          uThemeT: { value: 1 },
          uSelected: { value: 0 },
          uFromMetricIndex: { value: 0 },
          uToMetricIndex: { value: 0 },
          uOcean: { value: new Color(COUNTRY_TEXTURE_STYLE.oceanColor) },
          uBorder: { value: new Color(COUNTRY_VECTOR_BORDER_COLOR) },
          uBorderLight: { value: new Color('#ffffff') },
          uSelection: { value: new Color('#6b261c') },
          uAmbient: { value: 0.72 },
          uDirectional: { value: 0.3 },
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
    theme.sync(data.metric, reducedMotion, performance.now());
    syncTransitionUniforms(transition, material, theme);
    setMorphState(transition.active || theme.active ? 'animating' : 'settled');
    invalidate();
  }, [
    data.inverse,
    data.metric,
    shape,
    replayKey,
    reducedMotion,
    requestedMetric,
    transition,
    theme,
    material,
    invalidate,
    setMorphState,
  ]);
  useEffect(() => {
    mappingRef.current = {
      inverse: (p) => inversePoint(p, transition.mapping),
      forward: (p) => forwardPoint(p, transition.mapping),
      theme: () => theme,
      unitId: (p) =>
        data.unitsByRasterId.get(
          sampleReshapedId(resources.raster, p.latitude, p.longitude),
        )?.id ?? null,
    };
    return () => {
      mappingRef.current = null;
    };
  }, [data, mappingRef, resources, transition, theme]);
  useEffect(
    () => () => {
      resources.texture.dispose();
      resources.distances.dispose();
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
    if (transition.active || theme.active) {
      const now = performance.now();
      transition.tick(now);
      if (theme.active) theme.tick(now);
      syncTransitionUniforms(transition, currentShader, theme);
      if (transition.active || theme.active) invalidate();
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
