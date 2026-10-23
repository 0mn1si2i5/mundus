import { useFrame, useThree } from '@react-three/fiber';
import {
  useEffect,
  useCallback,
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
  RGBFormat,
  RedFormat,
  RGBAFormat,
  RGFormat,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector4,
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
  loadReshapedPatches,
  sampleReshapedId,
  sampleReshapedPatchLabel,
  type ReshapedPatchAtlas,
  type ReshapedDataset,
} from '../reshaped/reshapedData';
import { buildReshapedPatchBins } from '../reshaped/patchSampling.mjs';
import type { InverseField } from '../reshaped/inverseFormat.mjs';
import {
  ReshapedTransition,
  ReshapedThemeTransition,
} from './reshapedTransition';
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
      casing: new Color(RESHAPED_METRIC_THEMES[id].casing),
      selection: new Color(RESHAPED_METRIC_THEMES[id].selection),
    },
  ]),
) as Record<
  ReshapedMetricId,
  { ocean: Color; border: Color; casing: Color; selection: Color }
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
vec4 classifyTexels(int ids[4], int bits[4], float distances[4], float weights[4], float distanceCap) {
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
  for(int k=0;k<4;k++) if(ids[k]!=bestId || distances[k]<distanceCap) cappedInterior=false;
  return vec4(float(bestId),best*4.0/255.0,float(bestBits),cappedInterior?1.0:0.0);
}
// Analytic gradient of the winning bilinear signed distance. Reuses the
// four fetched texels; no fragment derivatives inside divergent sampling.
vec2 labelGradient(int ids[4], float distances[4], vec2 f, int id) {
  vec4 d=vec4(distances[0],distances[1],distances[2],distances[3]);
  for(int i=0;i<4;i++) if(ids[i]!=id) d[i]=-d[i];
  return vec2(mix(d.y-d.x,d.w-d.z,f.y),mix(d.z-d.x,d.w-d.y,f.x))*4.0/255.0;
}
vec4 classify(vec2 uv, out vec2 gradient) {
  ivec2 size=textureSize(uIds,0);
  vec2 scaled=vec2(fract(uv.x),clamp(uv.y,0.0,1.0))*vec2(size)-0.5;
  ivec2 base=ivec2(floor(scaled)); vec2 f=fract(scaled);
  int ids[4]; int bits[4]; float distances[4]; float weights[4];
  for(int j=0;j<2;j++) for(int i=0;i<2;i++) {
    int k=j*2+i; int x=(base.x+i)%size.x; if(x<0)x+=size.x;
    int y=clamp(base.y+j,0,size.y-1); ivec2 p=ivec2(x,y);
    vec2 packed=floor(texelFetch(uIds,p,0).rg*255.0+0.5);
    ids[k]=int(packed.x); bits[k]=int(packed.y);
    distances[k]=floor(texelFetch(uDistances,p,0).r*255.0+0.5);
    weights[k]=((i==0)?1.0-f.x:f.x)*((j==0)?1.0-f.y:f.y);
  }
  vec4 label=classifyTexels(ids,bits,distances,weights,uDistanceCap);
  gradient=labelGradient(ids,distances,f,int(label.x));
  return label;
}
vec4 classify(vec2 uv) { vec2 gradient; return classify(uv,gradient); }`;

export const RESHAPED_PATCH_GLSL = `
uniform sampler2D uPatchAtlas;
uniform int uPatchCount;
uniform vec4 uPatchBboxes[64];
uniform vec4 uPatchRects[64];
uniform uvec2 uPatchBins[32];
vec4 classifyPatch(vec2 uv, vec4 rect, out vec2 gradient) {
  vec2 inner=rect.zw-vec2(2.0);
  vec2 scaled=uv*inner-vec2(0.5);
  ivec2 base=ivec2(floor(scaled)); vec2 f=fract(scaled);
  int ids[4]; int bits[4]; float distances[4]; float weights[4];
  for(int j=0;j<2;j++) for(int i=0;i<2;i++) {
    int k=j*2+i;
    ivec2 p=ivec2(rect.xy)+ivec2(1)+base+ivec2(i,j);
    p.x=clamp(p.x,int(rect.x)+1,int(rect.x+rect.z)-2);
    p.y=clamp(p.y,int(rect.y)+1,int(rect.y+rect.w)-2);
    vec3 packed=floor(texelFetch(uPatchAtlas,p,0).rgb*255.0+0.5);
    ids[k]=int(packed.x); bits[k]=int(packed.y); distances[k]=packed.z;
    weights[k]=((i==0)?1.0-f.x:f.x)*((j==0)?1.0-f.y:f.y);
  }
  vec4 label=classifyTexels(ids,bits,distances,weights,255.0);
  gradient=labelGradient(ids,distances,f,int(label.x));
  return label;
}
vec4 classifyPatch(vec2 uv, vec4 rect) { vec2 gradient; return classifyPatch(uv,rect,gradient); }
int patchAt(vec2 uv, out vec2 patchUv, out float patchWeight) {
  patchWeight=0.0; patchUv=vec2(0.0);
  float lon=wrapLongitude(uv.x*360.0-180.0); float lat=90.0-uv.y*180.0;
  int binX=clamp(int(floor((lon+180.0)/45.0)),0,7);
  int binY=clamp(int(floor((90.0-lat)/45.0)),0,3);
  uvec2 candidates=uPatchBins[binY*8+binX];
  if(all(equal(candidates,uvec2(0u)))) return -1;
  for(int i=0;i<64;i++) {
    if(i>=uPatchCount) break;
    uint mask=i<32?candidates.x:candidates.y;
    if((mask & (1u << uint(i%32)))==0u) continue;
    vec4 box=uPatchBboxes[i]; float center=(box.x+box.z)*0.5;
    float localLon=lon; while(localLon-center>180.0)localLon-=360.0; while(localLon-center<-180.0)localLon+=360.0;
    if(localLon<box.x || localLon>box.z || lat<box.y || lat>box.w) continue;
    float edge=min(min(localLon-box.x,box.z-localLon)/(${360 / 4096.0}),min(lat-box.y,box.w-lat)/(${180 / 2048.0}));
    patchWeight=smoothstep(0.0,2.0,edge);
    patchUv=vec2((localLon-box.x)/(box.z-box.x),(box.w-lat)/(box.w-box.y));
    return i;
  }
  return -1;
}
`;

export const RESHAPED_FRAGMENT_SHADER = `
layout(location=0) out highp vec4 reshapedColor;
#define gl_FragColor reshapedColor
uniform sampler2D uFromField; uniform sampler2D uToField; uniform sampler2D uIds; uniform sampler2D uDistances; uniform sampler2D uPalette;
uniform int uHasFrom; uniform int uHasTo;
uniform int uFromPaddingBit; uniform int uToPaddingBit;
uniform int uFromMetricIndex; uniform int uToMetricIndex;
uniform float uT; uniform float uThemeT; uniform int uSelected; uniform vec3 uOcean; uniform vec3 uBorder; uniform vec3 uSelection;
uniform float uAmbient; uniform float uDirectional;
uniform vec3 uCasing; uniform float uCasingOpacity; uniform float uPixelRatio;
in vec3 vGeo; in vec3 vNormal;
${RESHAPED_SAMPLING_GLSL}

${RESHAPED_LABEL_GLSL}
${RESHAPED_PATCH_GLSL}

vec3 palette(int metricIndex,int id) {
  ivec2 size=textureSize(uPalette,0);
  return texelFetch(uPalette,ivec2(clamp(id,0,size.x-1),clamp(metricIndex,0,size.y-1)),0).rgb;
}
vec4 shadeLabel(vec4 label, vec3 p, float footprint, float edgeWidth, float stripeAa) {
  int id=int(label.x+0.5);
  vec3 color=id==0?uOcean:mix(palette(uFromMetricIndex,id),palette(uToMetricIndex,id),uThemeT);
  float padding=id==0?0.0:paddingWeight(int(label.z+0.5),uFromPaddingBit,uToPaddingBit,uT);
  float phase=dot(p,vec3(1.0,1.0,0.35))*90.0;
  float stripeDistance=abs(fract(phase)-0.5);
  float stripe=1.0-smoothstep(0.10-stripeAa,0.10+stripeAa,stripeDistance);
  float grey=dot(color,vec3(0.2126,0.7152,0.0722));
  vec3 paddingColor=mix(vec3(grey),color,0.30);
  paddingColor=mix(paddingColor,vec3(1.0),0.15);
  paddingColor=mix(paddingColor,vec3(0.18,0.13,0.09),stripe*0.65);
  color=mix(color,paddingColor,padding);
  float px=label.y/max(footprint*uPixelRatio,0.0001);
  float aa=clamp(edgeWidth*0.5/max(footprint*uPixelRatio,0.0001),0.25/uPixelRatio,0.75/uPixelRatio);
  // Saturated B means distance >= its cap, not distance = its cap. Painting it
  // as a real edge floods small globes with border ink at large footprints.
  // The unsigned distance gives the same half-width on either side: 0.5 CSS
  // px of ink, followed by 0.75 CSS px of casing. Both rasters share this path.
  float casing=label.w>0.5?0.0:1.0-smoothstep(1.25-aa,1.25+aa,px);
  float border=label.w>0.5?0.0:1.0-smoothstep(0.5-aa,0.5+aa,px);
  color=mix(color,uCasing,casing*uCasingOpacity);
  color=mix(color,uBorder,border);
  if(id!=0 && id==uSelected && label.w<0.5) {
    // A fine local distance field can saturate before the wide inner ring
    // when zoomed out. Keep selection visible on the boundary itself too.
    color=mix(color,uSelection,border);
    float ring=smoothstep(1.25-aa,1.25+aa,px)*(1.0-smoothstep(4.25-aa,4.25+aa,px));
    color=mix(color,uSelection,ring);
    float outerCasing=smoothstep(4.25-aa,4.25+aa,px)*(1.0-smoothstep(6.0-aa,6.0+aa,px));
    color=mix(color,uCasing,outerCasing*uCasingOpacity);
    float outerInk=smoothstep(4.25-aa,4.25+aa,px)*(1.0-smoothstep(5.25-aa,5.25+aa,px));
    color=mix(color,uBorder,outerInk);
  }
  // Alpha is an internal sampling hint, not display opacity. Include the
  // whole selected ring so its outer edges receive the same extra samples.
  float edgeSamples=label.w>0.5?0.0:float(px<(id!=0 && id==uSelected?6.0+aa:1.25+aa));
  return vec4(color,edgeSamples);
}
// Distance changes perpendicular to an edge determine its screen width.
// The full UV footprint is only a fallback for quantized/flat distance cells.
vec2 edgeFootprint(vec2 gradient, vec2 dx, vec2 dy, vec2 size) {
  vec2 screenGradient=vec2(dot(gradient,dx*size),dot(gradient,dy*size));
  float normalWidth=length(screenGradient);
  if(normalWidth>0.00001) return vec2(normalWidth,abs(screenGradient.x)+abs(screenGradient.y));
  return vec2(max(length(dx*size),length(dy*size)),length((abs(dx)+abs(dy))*size));
}
vec4 shadeAt(vec2 uv, vec3 p, vec2 dx, vec2 dy, vec2 derivativeWidth, float stripeAa) {
  vec2 baseSize=vec2(textureSize(uIds,0));
  float footprint=max(length(dx*baseSize),length(dy*baseSize));
  vec2 patchUv; float patchWeight;
  int index=patchAt(uv,patchUv,patchWeight);
  bool usePatch=index>=0 && patchWeight>0.0;
  // Shade the base raster at one call site for the same compile-size reason.
  vec4 baseColor=vec4(0.0);
  if(!usePatch || patchWeight<1.0) {
    vec2 gradient; vec4 label=classify(uv,gradient);
    vec2 edge=edgeFootprint(gradient,dx,dy,baseSize);
    baseColor=shadeLabel(label,p,edge.x,edge.y,stripeAa);
  }
  if(!usePatch) return baseColor;
  vec4 box=uPatchBboxes[index];
  vec2 patchSize=(uPatchRects[index].zw-2.0)*vec2(360.0/(box.z-box.x),180.0/(box.w-box.y));
  vec2 gradient; vec4 label=classifyPatch(patchUv,uPatchRects[index],gradient);
  vec2 edge=edgeFootprint(gradient,dx,dy,patchSize);
  vec4 patchColor=shadeLabel(label,p,edge.x,edge.y,stripeAa);
  if(patchWeight>=1.0) return patchColor;
  return mix(baseColor,patchColor,patchWeight);
}
void main() {
  vec3 p=normalize(vGeo); float longitude=degrees(atan(p.x,p.z)); float s=p.y; float latitude=degrees(atan(p.y,length(p.xz)));
  vec2 source=inverseMapping(uFromField,uToField,uHasFrom,uHasTo,longitude,latitude,s,uT);
  vec2 uv=vec2((source.x+180.0)/360.0,(90.0-source.y)/180.0);
  vec2 dx=dFdx(uv),dy=dFdy(uv); if(abs(dx.x)>0.5)dx.x-=sign(dx.x); if(abs(dy.x)>0.5)dy.x-=sign(dy.x);
  // Derivatives must run for every fragment before patch, label and sampling
  // branches. The seam-corrected sum is fwidth(uv) without a dateline spike.
  vec2 derivativeWidth=abs(dx)+abs(dy);
  float stripeAa=max(fwidth(dot(p,vec3(1.0,1.0,0.35))*90.0),0.001);
  vec2 texelSize=vec2(textureSize(uIds,0)); float footprint=max(length(dx*texelSize),length(dy*texelSize));
  vec2 patchUv; float patchWeight; int patchIndex=patchAt(uv,patchUv,patchWeight);
  if(patchIndex>=0) {
    vec4 box=uPatchBboxes[patchIndex];
    vec2 patchSize=(uPatchRects[patchIndex].zw-2.0)*vec2(360.0/(box.z-box.x),180.0/(box.w-box.y));
    footprint=max(footprint,max(length(dx*patchSize),length(dy*patchSize)));
  }
  vec2 offsets[8]=vec2[8](vec2(-0.375,-0.125),vec2(0.125,-0.375),vec2(0.375,0.125),vec2(-0.125,0.375),vec2(-0.125,-0.375),vec2(0.375,-0.125),vec2(0.125,0.375),vec2(-0.375,0.125));
  bool supersample=footprint>1.0;
  int sampleCount=supersample?4:1;
  vec4 samples=vec4(0.0);
  // One shadeAt call site: compilers inline every call, and the former nine
  // unrolled copies made SwiftShader spend about 2 s compiling this shader.
  for(int i=0;i<8;i++) {
    if(i>=sampleCount) break;
    vec2 offset=supersample?offsets[i]:vec2(0.0);
    samples+=shadeAt(uv+dx*offset.x+dy*offset.y,p,dx,dy,derivativeWidth,stripeAa);
    // Four more samples near rendered boundaries reduce aliasing from the
    // casing. All derivatives above precede this per-fragment decision.
    if(i==3 && samples.a>0.0) sampleCount=8;
  }
  vec3 color=samples.rgb/float(sampleCount);
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

function patchResources(atlas: ReshapedPatchAtlas | null) {
  if (!atlas) return null;
  const bytes = new Uint8Array(atlas.raster.ids.length * 3);
  for (let i = 0; i < atlas.raster.ids.length; i += 1) {
    bytes[i * 3] = atlas.raster.ids[i]!;
    bytes[i * 3 + 1] = atlas.raster.padding?.[i] ?? 0;
    bytes[i * 3 + 2] = atlas.raster.distance?.[i] ?? 0;
  }
  const texture = new DataTexture(
    bytes,
    atlas.width,
    atlas.height,
    RGBFormat,
    UnsignedByteType,
  );
  texture.internalFormat = 'RGB8';
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, atlas };
}

function syncPatchUniforms(
  material: ShaderMaterial,
  patches: ReturnType<typeof patchResources>,
) {
  const uniforms = material.uniforms;
  uniforms.uPatchAtlas!.value = patches?.texture ?? null;
  uniforms.uPatchCount!.value = patches?.atlas.patches.length ?? 0;
  uniforms.uPatchBins!.value = buildReshapedPatchBins(patches?.atlas ?? null);
  for (let index = 0; index < 64; index++) {
    const patch = patches?.atlas.patches[index];
    const box = patch?.bbox;
    (uniforms.uPatchBboxes!.value[index] as Vector4).set(
      box?.[0] ?? 0,
      box?.[1] ?? 0,
      box?.[2] ?? 0,
      box?.[3] ?? 0,
    );
    const rect = patch?.atlas;
    (uniforms.uPatchRects!.value[index] as Vector4).set(
      rect?.x ?? 0,
      rect?.y ?? 0,
      rect?.width ?? 1,
      rect?.height ?? 1,
    );
  }
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
    .uCasing!.value.copy(THEME_COLORS[fromMetric].casing)
    .lerp(THEME_COLORS[toMetric].casing, theme.t);
  material.uniforms.uCasingOpacity!.value =
    fromTheme.casingOpacity +
    (toTheme.casingOpacity - fromTheme.casingOpacity) * theme.t;
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
  onPatchesReady,
}: {
  profile: QualityProfile;
  shape: 'true' | 'reshaped';
  data: ReshapedDataset;
  replayKey: number;
  mappingRef: MutableRefObject<ReshapedMappingHandle | null>;
  onPatchesReady?: (atlas: ReshapedPatchAtlas) => void;
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
  const [patchAtlas, setPatchAtlas] = useState<ReshapedPatchAtlas | null>(
    data.patchAtlas ?? null,
  );
  const patchLoadStarted = useRef(false);
  const reportSettled = useRef(false);
  const patchLoadController = useRef<AbortController | null>(null);
  const marker = useRef<Mesh>(null);
  const shader = useRef<ShaderMaterial>(null);
  const { ids, units, values } = data;
  const resources = useMemo(
    () => idResources({ ids, units, values }),
    [ids, units, values],
  );
  const patches = useMemo(() => patchResources(patchAtlas), [patchAtlas]);
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
          uCasing: { value: new Color('#fbf7ee') },
          uCasingOpacity: { value: 0.85 },
          uPixelRatio: { value: 1 },
          uSelection: { value: new Color('#e8562a') },
          uPatchAtlas: { value: null },
          uPatchCount: { value: 0 },
          uPatchBins: { value: new Uint32Array(64) },
          uPatchBboxes: {
            value: Array.from({ length: 64 }, () => new Vector4()),
          },
          uPatchRects: {
            value: Array.from({ length: 64 }, () => new Vector4(0, 0, 1, 1)),
          },
          uAmbient: { value: 0.72 },
          uDirectional: { value: 0.3 },
        },
      }),
    [resources],
  );
  useEffect(() => {
    syncPatchUniforms(material, patches);
    // Updating uniforms keeps the base shader program alive when the atlas arrives.
    invalidate();
  }, [patches, material, invalidate]);
  const loadPatchesAfterFirstFrame = useCallback(() => {
    if (patchLoadStarted.current || patchAtlas) return;
    patchLoadStarted.current = true;
    const controller = new AbortController();
    patchLoadController.current = controller;
    // This callback runs after the base mesh reached WebGL. Starting the
    // request here avoids waiting for a second React commit on slow browsers.
    loadReshapedPatches(controller.signal)
      .then((atlas) => {
        if (!controller.signal.aborted) {
          setPatchAtlas(atlas);
          onPatchesReady?.(atlas);
        }
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          !(error instanceof DOMException && error.name === 'AbortError')
        )
          console.warn('Reshaped Earth local ID patches unavailable', error);
      });
  }, [onPatchesReady, patchAtlas]);
  useEffect(
    () => () => {
      patchLoadController.current?.abort();
      patchLoadController.current = null;
    },
    [],
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
    // While another measure loads, the old map stays on screen but the
    // requested one has not been drawn.
    const loading = data.metric !== requestedMetric;
    const animating = transition.active || theme.active;
    reportSettled.current = !loading && !animating;
    if (loading) setMorphState('pending');
    else if (animating) setMorphState('animating');
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
          sampleReshapedPatchLabel(patchAtlas, p.latitude, p.longitude)?.id ??
            sampleReshapedId(resources.raster, p.latitude, p.longitude),
        )?.id ?? null,
    };
    return () => {
      mappingRef.current = null;
    };
  }, [data, mappingRef, resources, transition, theme, patchAtlas]);
  useEffect(
    () => () => {
      resources.texture.dispose();
      resources.distances.dispose();
      resources.palette.dispose();
    },
    [resources],
  );
  useEffect(() => () => patches?.texture.dispose(), [patches]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => transition.dispose(), [transition]);
  // A layer that mounts again has drawn nothing yet.
  useEffect(() => () => setMorphState('pending'), [setMorphState]);
  useFrame(({ gl }) => {
    const currentShader = shader.current;
    if (!currentShader) return;
    currentShader.uniforms.uPixelRatio!.value = gl.getPixelRatio();
    if (transition.active || theme.active) {
      const now = performance.now();
      transition.tick(now);
      if (theme.active) theme.tick(now);
      syncTransitionUniforms(transition, currentShader, theme);
      if (transition.active || theme.active) invalidate();
      else reportSettled.current = true;
    }
    // useFrame runs just before this frame's draw, so the result never
    // announces a shape the canvas has not drawn yet.
    if (reportSettled.current) {
      reportSettled.current = false;
      setMorphState('settled');
    }
    const selected =
      selectedOverride !== undefined
        ? selectedOverride === null
          ? 0
          : data.unitsById.get(selectedOverride)?.rasterId
        : (sampleReshapedPatchLabel(patchAtlas, point.latitude, point.longitude)
            ?.id ??
          sampleReshapedId(resources.raster, point.latitude, point.longitude));
    currentShader.uniforms.uSelected!.value = selected ?? 0;
    if (marker.current)
      marker.current.position.copy(
        geoToVector3(forwardPoint(point, transition.mapping), 1.012),
      );
  });
  return (
    <>
      <mesh
        geometry={geometry}
        material={material}
        raycast={ignoreRaycast}
        onAfterRender={loadPatchesAfterFirstFrame}
      />
      <mesh ref={marker} raycast={ignoreRaycast}>
        <sphereGeometry args={[0.007, 12, 8]} />
        <meshBasicMaterial color="#7f2f24" />
      </mesh>
    </>
  );
}
