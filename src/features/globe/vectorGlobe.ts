import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  Uint16BufferAttribute,
  UnsignedByteType,
} from 'three';
import { COUNTRY_TEXTURE_STYLE } from './countryData';

export interface VectorCountry {
  countryId: string;
  name: string;
  countryIndex: number;
}

export interface VectorStreamDescriptor {
  name: string;
  mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';
  count: number;
  stride: number;
  byteLength: number;
}

export interface DecodedVectorGlobe {
  countries: VectorCountry[];
  descriptors: VectorStreamDescriptor[];
  streams: Record<string, Uint8Array>;
}

export interface VectorGlobeResources {
  countries: readonly VectorCountry[];
  surface: BufferGeometry;
  coastline: BufferGeometry;
  borders: BufferGeometry;
  palette: DataTexture;
  dispose: () => void;
}

const PALETTE_WIDTH = 905;
const BASE_LAND = new Color(COUNTRY_TEXTURE_STYLE.landColor);
const HOVER = new Color('#779c91');
const SELECTED = new Color('#c98755');

export function createVectorGlobeResources(
  decoded: DecodedVectorGlobe,
): VectorGlobeResources {
  const descriptors = new Map(
    decoded.descriptors.map((descriptor) => [descriptor.name, descriptor]),
  );
  let surface: BufferGeometry | undefined;
  let coastline: BufferGeometry | undefined;
  let borders: BufferGeometry | undefined;
  let palette: DataTexture | undefined;
  try {
    surface = createGeometry(decoded, descriptors, 'surface');
    coastline = createGeometry(decoded, descriptors, 'coast');
    borders = createGeometry(decoded, descriptors, 'border');
    palette = new DataTexture(
      new Uint8Array(PALETTE_WIDTH * 4),
      PALETTE_WIDTH,
      1,
      RGBAFormat,
      UnsignedByteType,
    );
  } catch (error) {
    surface?.dispose();
    coastline?.dispose();
    borders?.dispose();
    palette?.dispose();
    throw error;
  }
  palette.minFilter = NearestFilter;
  palette.magFilter = NearestFilter;
  palette.generateMipmaps = false;
  palette.colorSpace = SRGBColorSpace;

  const resources: VectorGlobeResources = {
    countries: decoded.countries,
    surface,
    coastline,
    borders,
    palette,
    dispose() {
      surface.dispose();
      coastline.dispose();
      borders.dispose();
      palette.dispose();
    },
  };
  updateVectorPalette(resources, null, null);
  return resources;
}

export function updateVectorPalette(
  resources: VectorGlobeResources,
  hoveredCountryId: string | null,
  selectedCountryId: string | null,
) {
  const bytes = resources.palette.image.data as Uint8Array;
  bytes.fill(0);
  for (const country of resources.countries) {
    const color = new Color(BASE_LAND);
    if (country.countryId === selectedCountryId) color.copy(SELECTED);
    else if (country.countryId === hoveredCountryId) color.copy(HOVER);
    color.convertLinearToSRGB();
    const offset = country.countryIndex * 4;
    bytes[offset] = Math.round(color.r * 255);
    bytes[offset + 1] = Math.round(color.g * 255);
    bytes[offset + 2] = Math.round(color.b * 255);
    bytes[offset + 3] = 255;
  }
  resources.palette.needsUpdate = true;
}

function createGeometry(
  decoded: DecodedVectorGlobe,
  descriptors: ReadonlyMap<string, VectorStreamDescriptor>,
  prefix: 'surface' | 'coast' | 'border',
) {
  const vertexName = `${prefix}Vertex`;
  const indexName = `${prefix}Index`;
  const vertexDescriptor = required(descriptors, vertexName);
  const indexDescriptor = required(descriptors, indexName);
  const vertexBytes = decoded.streams[vertexName];
  const indexBytes = decoded.streams[indexName];
  if (!vertexBytes || !indexBytes)
    throw new Error(`Missing vector stream ${prefix}`);

  const positions = new Float32Array(vertexDescriptor.count * 3);
  const countryIndices = new Uint16Array(vertexDescriptor.count);
  const view = new DataView(
    vertexBytes.buffer,
    vertexBytes.byteOffset,
    vertexBytes.byteLength,
  );
  for (let index = 0; index < vertexDescriptor.count; index += 1) {
    const byteOffset = index * vertexDescriptor.stride;
    const sourceX = view.getInt16(byteOffset, true) / 32767;
    const sourceY = view.getInt16(byteOffset + 2, true) / 32767;
    const sourceZ = view.getInt16(byteOffset + 4, true) / 32767;
    // Converter uses X=east at 0 longitude, Y=east at 90, Z=north.
    positions[index * 3] = sourceY;
    positions[index * 3 + 1] = sourceZ;
    positions[index * 3 + 2] = sourceX;
    countryIndices[index] = view.getUint16(byteOffset + 6, true);
    if (prefix === 'surface' && countryIndices[index]! >= PALETTE_WIDTH) {
      throw new Error(`Invalid vector country index ${countryIndices[index]}`);
    }
  }

  const IndexArray = indexDescriptor.stride === 2 ? Uint16Array : Uint32Array;
  const ownedIndexBytes = new Uint8Array(indexBytes.byteLength);
  ownedIndexBytes.set(indexBytes);
  const indices = new IndexArray(ownedIndexBytes.buffer);
  for (const index of indices) {
    if (index >= vertexDescriptor.count) {
      throw new Error(`Invalid vector ${prefix} index ${index}`);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (prefix === 'surface') {
    geometry.setAttribute(
      'countryIndex',
      new Uint16BufferAttribute(countryIndices, 1),
    );
  }
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function required(
  descriptors: ReadonlyMap<string, VectorStreamDescriptor>,
  name: string,
) {
  const descriptor = descriptors.get(name);
  if (!descriptor) throw new Error(`Missing vector descriptor ${name}`);
  return descriptor;
}
