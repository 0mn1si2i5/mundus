import { geoBounds, geoContains, geoEquirectangular, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import atlas from '../../data/generated/mundus-countries-110m.json';
import type { GeoPoint } from './geo';
import type { CountryRef } from './country';

export type { CountryRef } from './country';

export interface CountryFeatureProperties {
  countryId: string;
  name: string;
}

type CountryTopology = Topology<{
  countries: GeometryCollection<CountryFeatureProperties>;
}>;

export type CountryFeature = Feature<Geometry, CountryFeatureProperties>;

interface IndexedCountry {
  feature: CountryFeature;
  south: number;
  north: number;
}

export interface CountryDataset {
  countries: FeatureCollection<Geometry, CountryFeatureProperties>;
  findCountry: (point: GeoPoint) => CountryRef | null;
}

export interface CountryTextureStyle {
  oceanColor: string;
  landColor: string;
  borderColor: string;
  borderWidth: number;
}

export interface CountryHighlightTexture {
  texture: CanvasTexture;
  update: (
    hoveredCountryId: string | null,
    selectedCountryId: string | null,
  ) => void;
}

let cachedDataset: CountryDataset | undefined;

export const COUNTRY_TEXTURE_STYLE = {
  oceanColor: '#c7d2cd',
  landColor: '#ddd2b5',
  borderColor: 'rgba(67, 66, 58, 0.82)',
} as const;

export const COUNTRY_VECTOR_BORDER_COLOR = '#43423a';

export function getCountryDataset(): CountryDataset {
  const cached = cachedDataset;
  if (cached) return cached;

  const countries: FeatureCollection<Geometry, CountryFeatureProperties> = {
    type: 'FeatureCollection',
    features: [...countryFeaturesFromTopology(atlas)],
  };
  const index: IndexedCountry[] = countries.features.map((country) => {
    const [[, south], [, north]] = geoBounds(country);
    return { feature: country, south, north };
  });

  const dataset: CountryDataset = {
    countries,
    findCountry: ({ latitude, longitude }) => {
      const match = index.find(
        ({ feature: candidate, south, north }) =>
          latitude >= south &&
          latitude <= north &&
          geoContains(candidate, [longitude, latitude]),
      );
      return match
        ? {
            countryId: match.feature.properties.countryId,
            name: match.feature.properties.name,
          }
        : null;
    },
  };

  cachedDataset = dataset;
  return cachedDataset;
}

/**
 * Reads a generated Mundus country topology; each unit already carries its
 * stable `countryId` (see scripts/build-mundus-countries.mjs).
 */
export function countryFeaturesFromTopology(
  countryTopology: unknown,
): readonly CountryFeature[] {
  const topology = countryTopology as CountryTopology;
  const raw = feature(
    topology,
    topology.objects.countries,
  ) as unknown as FeatureCollection<Geometry, CountryFeatureProperties>;
  return raw.features;
}

export function createCountryTexture(
  dataset: CountryDataset,
  textureWidth: number,
  maxAnisotropy = 1,
): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = textureWidth;
  canvas.height = textureWidth / 2;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Canvas 2D is required to render country texture');

  const style = getCountryTextureStyle(textureWidth);
  context.fillStyle = style.oceanColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const projection = geoEquirectangular()
    .fitSize([canvas.width, canvas.height], { type: 'Sphere' })
    .precision(0.2);
  const path = geoPath(projection, context);

  context.beginPath();
  path(dataset.countries);
  context.fillStyle = style.landColor;
  context.fill();

  context.beginPath();
  path(dataset.countries);
  context.strokeStyle = style.borderColor;
  context.lineWidth = style.borderWidth;
  context.stroke();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.offset.x = 0.25;
  texture.anisotropy = getBoundedTextureAnisotropy(maxAnisotropy);
  texture.needsUpdate = true;
  return texture;
}

export function createCountryHighlightTexture(
  dataset: CountryDataset,
  baseTextureWidth: number,
  maxAnisotropy = 1,
): CountryHighlightTexture {
  const textureWidth = getCountryHighlightTextureWidth(baseTextureWidth);
  const canvas = document.createElement('canvas');
  canvas.width = textureWidth;
  canvas.height = textureWidth / 2;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Canvas 2D is required to render country highlights');

  const projection = geoEquirectangular()
    .fitSize([canvas.width, canvas.height], { type: 'Sphere' })
    .precision(0.2);
  const path = geoPath(projection, context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.offset.x = 0.25;
  texture.anisotropy = getBoundedTextureAnisotropy(maxAnisotropy);

  return {
    texture,
    update(hoveredCountryId, selectedCountryId) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawCountry(context, path, dataset, selectedCountryId, '#c98755', 0.82);
      drawCountry(context, path, dataset, hoveredCountryId, '#779c91', 0.68);
      texture.needsUpdate = true;
    },
  };
}

export function getCountryTextureStyle(
  textureWidth: number,
): CountryTextureStyle {
  return {
    ...COUNTRY_TEXTURE_STYLE,
    borderWidth: Math.max(1, textureWidth / 2048),
  };
}

export function getBoundedTextureAnisotropy(maxAnisotropy: number): number {
  return Math.max(1, Math.min(8, maxAnisotropy));
}

export function getCountryHighlightTextureWidth(
  baseTextureWidth: number,
): number {
  return Math.min(1024, baseTextureWidth);
}

function drawCountry(
  context: CanvasRenderingContext2D,
  path: ReturnType<typeof geoPath>,
  dataset: CountryDataset,
  countryId: string | null,
  color: string,
  alpha: number,
) {
  if (!countryId) return;
  const country = dataset.countries.features.find(
    (feature) => feature.properties.countryId === countryId,
  );
  if (!country) return;

  context.save();
  context.globalAlpha = alpha;
  context.beginPath();
  path(country);
  context.fillStyle = color;
  context.fill();
  context.restore();
}
