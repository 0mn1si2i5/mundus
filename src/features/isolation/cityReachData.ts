import { z } from 'zod';
import type { Locale } from '../../i18n/messages';
import type { GeoPoint } from '../globe/geo';
import {
  CITY_REACH_DEFAULT,
  CITY_REACH_LEVELS,
  isCityReachLevel,
  type CityReachLevel,
} from './cityReachLevel';
import type {
  CityReachCity,
  CityReachFrame,
  CityReachManifest,
  CityReachMetadata,
  CityReachPointSelection,
  CityReachQuality,
  CityReachTextureAsset,
  DecodedOwnerTile,
  DecodedDensityTexture,
} from './cityReachTypes';
export type * from './cityReachTypes';

const manifestImporters = Object.values(
  import.meta.glob<string>('../../data/manifests/city-reach.json', {
    query: '?raw',
    import: 'default',
  }),
);
const cityImporters = Object.values(
  import.meta.glob<string>('../../data/generated/city-reach.json', {
    query: '?raw',
    import: 'default',
  }),
);

const positiveInteger = z.number().int().positive();
const pointSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
const nameSchema = z.object({ en: z.string(), zh: z.string().nullable() });
const citySchema = z.object({
  id: positiveInteger,
  ownerIndex: positiveInteger,
  name: nameSchema,
  country: nameSchema,
  nameMatchType: z.enum(['override', 'exact', 'none']),
  population: z.number().finite().min(100_000),
  point: pointSchema,
  centrePoint: pointSchema.nullable(),
  threshold: z.number().finite().nonnegative().nullable(),
  parentId: positiveInteger.nullable(),
  status: z.enum([
    'ok',
    'root',
    'no_larger_reachable',
    'merged_at_resolution',
    'transport_missing',
    'disputed',
  ]),
  mergedIntoId: positiveInteger.nullable(),
});
const assetSchema = z.object({
  path: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  rawBytes: positiveInteger,
  gzipBytes: positiveInteger,
});
const textureSchema = assetSchema.extend({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: positiveInteger.max(4096),
  height: positiveInteger.max(4096),
});
const tierSchema = z.object({
  stride: positiveInteger,
  width: positiveInteger,
  height: positiveInteger,
  gpuBytes: positiveInteger,
  densityGpuBytes: positiveInteger,
  cpuOwnerBytes: positiveInteger,
  transitionGpuBytes: positiveInteger,
});
const qualityAssetsSchema = z
  .object({
    low: z.array(textureSchema).min(1),
  })
  .strict();
const manifestSchema = z.object({
  id: z.literal('city-reach'),
  formatVersion: z.literal(1),
  defaultLevel: z.literal(CITY_REACH_DEFAULT),
  defaultQuality: z.literal('low'),
  universeMinPopulation: z.literal(100_000),
  recordCount: positiveInteger.max(65534),
  grid: z.object({
    width: positiveInteger,
    height: positiveInteger,
    west: z.number().finite(),
    north: z.number().finite().min(-90).max(90),
    step: z.number().finite().positive(),
    wrapLongitude: z.boolean(),
  }),
  levels: z.array(z.number()),
  cityAsset: assetSchema,
  densityAsset: textureSchema,
  qualityTiers: z
    .object({
      low: tierSchema,
    })
    .strict(),
  ownershipAssets: z.object({
    '0.25': qualityAssetsSchema,
    '0.5': qualityAssetsSchema,
    '1': qualityAssetsSchema,
    '2': qualityAssetsSchema,
    '4': qualityAssetsSchema,
    '8': qualityAssetsSchema,
    '16': qualityAssetsSchema,
  }),
  ownerEncoding: z.object({
    format: z.literal('RGB8: R + 256 * G; B = 0'),
    cityIndexOffset: z.literal(1),
    unreachable: z.literal(0),
    disputed: z.literal(65535),
  }),
  densityEncoding: z.object({
    format: z.literal('RGB8: R = log-density; G = B = 0'),
    missing: z.literal(255),
  }),
});

function reviewed(city: CityReachCity) {
  return Boolean(
    city.name.en.trim() && city.country.en.trim() && city.country.zh?.trim(),
  );
}

export function decodeCityReachMetadata(
  rawManifest: unknown,
  rawCities: unknown,
): CityReachMetadata {
  const parsed = manifestSchema.parse(rawManifest);
  if (JSON.stringify(parsed.levels) !== JSON.stringify(CITY_REACH_LEVELS))
    throw new Error('City reach levels differ from the supported model');
  const manifest = parsed as CityReachManifest;
  const { grid } = manifest;
  if (
    grid.north - grid.height * grid.step < -90 ||
    grid.width * grid.step > 360 + 1e-8 ||
    (grid.wrapLongitude && Math.abs(grid.width * grid.step - 360) > 1e-8)
  )
    throw new Error('Invalid city reach grid coverage');
  const asset = z
    .object({
      formatVersion: z.literal(1),
      referenceYear: z.literal(2025),
      universeMinPopulation: z.literal(100_000),
      cities: z.array(citySchema).min(1).max(65534),
    })
    .parse(rawCities);
  if (asset.cities.length !== manifest.recordCount)
    throw new Error('City reach record count mismatch');
  const cities: readonly CityReachCity[] = asset.cities;
  const byId = new Map<number, CityReachCity>();
  for (const [index, city] of cities.entries()) {
    if (city.ownerIndex !== index + 1 || byId.has(city.id))
      throw new Error('Invalid city reach city identity');
    if (!city.country.en.trim() || !city.country.zh?.trim())
      throw new Error('Missing city reach country display name');
    if (
      city.nameMatchType === 'none'
        ? city.name.zh !== null
        : !city.name.zh?.trim()
    )
      throw new Error('Invalid city reach name provenance');
    if (
      city.status === 'ok'
        ? city.threshold === null || city.parentId === null
        : city.threshold !== null || city.parentId !== null
    )
      throw new Error('Invalid city reach threshold state');
    if (
      city.status === 'merged_at_resolution'
        ? city.mergedIntoId === null
        : city.mergedIntoId !== null
    )
      throw new Error('Invalid city reach merge state');
    byId.set(city.id, city);
  }
  for (const city of cities) {
    if (city.parentId !== null) {
      const parent = byId.get(city.parentId);
      if (!parent || parent.population <= city.population || !reviewed(parent))
        throw new Error('Invalid or unreviewed city reach parent');
    }
    if (
      city.mergedIntoId !== null &&
      (!byId.has(city.mergedIntoId) || city.mergedIntoId === city.id)
    )
      throw new Error('Invalid city reach merged target');
    if (
      (city.status === 'root' || city.status === 'no_larger_reachable') &&
      !reviewed(city)
    )
      throw new Error('Unreviewed city reach root');
  }
  for (const [quality, stride] of [['low', 4]] as const) {
    const tier = manifest.qualityTiers[quality];
    if (
      tier.stride !== stride ||
      tier.width !== Math.ceil(grid.width / stride) ||
      tier.height !== Math.ceil(grid.height / stride) ||
      tier.gpuBytes !== tier.width * tier.height * 4 ||
      tier.densityGpuBytes !== tier.gpuBytes ||
      tier.cpuOwnerBytes !== tier.width * tier.height * 2 ||
      tier.transitionGpuBytes !== tier.gpuBytes * 3
    )
      throw new Error('Invalid city reach quality budget');
    const density = manifest.densityAsset;
    if (
      !/^public\/data\/city-reach\/[a-zA-Z0-9_.-]+\.png$/.test(density.path) ||
      density.x !== 0 ||
      density.y !== 0 ||
      density.width !== tier.width ||
      density.height !== tier.height
    )
      throw new Error('Invalid city reach shared density texture');
    for (const level of CITY_REACH_LEVELS) {
      const tiles = manifest.ownershipAssets[level][quality];
      let pixels = 0;
      for (const [index, tile] of tiles.entries()) {
        if (
          !/^public\/data\/city-reach\/[a-zA-Z0-9_.-]+\.png$/.test(tile.path) ||
          tile.x + tile.width > tier.width ||
          tile.y + tile.height > tier.height
        )
          throw new Error('Invalid city reach texture coverage or path');
        if (
          tiles
            .slice(0, index)
            .some(
              (other) =>
                tile.x < other.x + other.width &&
                tile.x + tile.width > other.x &&
                tile.y < other.y + other.height &&
                tile.y + tile.height > other.y,
            )
        )
          throw new Error('Overlapping city reach textures');
        pixels += tile.width * tile.height;
      }
      if (pixels !== tier.width * tier.height)
        throw new Error('Incomplete city reach textures');
    }
  }
  return { manifest, cities, byId, inspectableCities: cities.filter(reviewed) };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('City reach loading cancelled', 'AbortError');
}

async function verifyBytes(
  bytes: Uint8Array,
  expected: { rawBytes: number; sha256: string },
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (bytes.length !== expected.rawBytes)
    throw new Error('City reach asset byte length mismatch');
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  throwIfAborted(signal);
  if (
    [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('') !==
    expected.sha256
  )
    throw new Error('City reach asset SHA-256 mismatch');
}

export interface CityReachMetadataSources {
  manifest(): Promise<string>;
  cities(): Promise<string>;
}

export async function loadCityReachMetadata(
  signal?: AbortSignal,
  sources?: CityReachMetadataSources,
): Promise<CityReachMetadata> {
  throwIfAborted(signal);
  const manifest = sources?.manifest ?? manifestImporters[0];
  const cities = sources?.cities ?? cityImporters[0];
  if (!manifest || !cities)
    throw new Error('City reach reviewed assets are not available');
  const rawManifest = JSON.parse(await manifest());
  throwIfAborted(signal);
  const text = await cities();
  throwIfAborted(signal);
  const identity = assetSchema.parse(rawManifest.cityAsset);
  await verifyBytes(new TextEncoder().encode(text), identity, signal);
  return decodeCityReachMetadata(rawManifest, JSON.parse(text));
}

async function imagePixels(
  bytes: Uint8Array,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([buffer], { type: 'image/png' });
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  const canvas = document.createElement('canvas');
  try {
    throwIfAborted(signal);
    let source: CanvasImageSource;
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
        imageOrientation: 'none',
      });
      if (bitmap.width !== width || bitmap.height !== height)
        throw new Error('Decoded city reach PNG dimensions mismatch');
      source = bitmap;
    } else {
      objectUrl = URL.createObjectURL(blob);
      image = new Image();
      await new Promise<void>((resolve, reject) => {
        const abort = () =>
          reject(new DOMException('City reach image cancelled', 'AbortError'));
        const finish = (error?: Error) => {
          signal?.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve();
        };
        signal?.addEventListener('abort', abort, { once: true });
        image!.onload = () => finish();
        image!.onerror = () =>
          finish(new Error('City reach PNG decode failed'));
        image!.src = objectUrl!;
      });
      if (image.naturalWidth !== width || image.naturalHeight !== height)
        throw new Error('Decoded city reach PNG dimensions mismatch');
      source = image;
    }
    throwIfAborted(signal);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('City reach PNG pixel reader is unavailable');
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    throwIfAborted(signal);
    return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  } finally {
    bitmap?.close();
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function decodeCityReachRgbPng(
  bytes: Uint8Array,
  asset: CityReachTextureAsset,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  await verifyBytes(bytes, asset, signal);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 45 ||
    signature.some((byte, index) => bytes[index] !== byte) ||
    header.getUint32(8) !== 13 ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR' ||
    header.getUint32(16) !== asset.width ||
    header.getUint32(20) !== asset.height ||
    bytes[24] !== 8 ||
    bytes[25] !== 2 ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  )
    throw new Error(
      'City reach PNG must be matching non-interlaced opaque RGB8',
    );
  const rgba = await imagePixels(bytes, asset.width, asset.height, signal);
  if (rgba.length !== asset.width * asset.height * 4)
    throw new Error('City reach PNG pixel length mismatch');
  for (let index = 3; index < rgba.length; index += 4)
    if (rgba[index] !== 255)
      throw new Error('City reach data PNG must remain opaque');
  return rgba;
}

export async function decodeCityReachOwnerPng(
  bytes: Uint8Array,
  asset: CityReachTextureAsset,
  cityCount: number,
  signal?: AbortSignal,
): Promise<DecodedOwnerTile> {
  const rgba = await decodeCityReachRgbPng(bytes, asset, signal);
  const owners = new Uint16Array(asset.width * asset.height);
  for (let index = 0; index < owners.length; index += 1) {
    const owner = rgba[index * 4]! + 256 * rgba[index * 4 + 1]!;
    if (owner !== 65535 && owner > cityCount)
      throw new Error('City reach PNG refers to an unknown owner');
    if (rgba[index * 4 + 2] !== 0)
      throw new Error('City reach owner PNG must have a zero B channel');
    owners[index] = owner;
  }
  throwIfAborted(signal);
  return {
    x: asset.x,
    y: asset.y,
    width: asset.width,
    height: asset.height,
    rgba,
    owners,
  };
}

export async function decodeCityReachDensityPng(
  bytes: Uint8Array,
  asset: CityReachTextureAsset,
  signal?: AbortSignal,
): Promise<DecodedDensityTexture> {
  const rgba = await decodeCityReachRgbPng(bytes, asset, signal);
  for (let index = 0; index < rgba.length; index += 4)
    if (rgba[index + 1] !== 0 || rgba[index + 2] !== 0)
      throw new Error('City reach density PNG must have zero G/B channels');
  return { width: asset.width, height: asset.height, rgba };
}

async function fetchTexture(
  asset: CityReachTextureAsset,
  signal?: AbortSignal,
) {
  const url = new URL(
    asset.path.slice('public/'.length),
    new URL(import.meta.env.BASE_URL, document.baseURI),
  );
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`City reach texture request failed (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadCityReachFrame(
  metadata: CityReachMetadata,
  level: CityReachLevel,
  quality: CityReachQuality = 'low',
  signal?: AbortSignal,
  sharedDensity?: DecodedDensityTexture,
): Promise<CityReachFrame> {
  throwIfAborted(signal);
  if (!isCityReachLevel(level)) throw new Error('Unsupported city reach level');
  const tier = metadata.manifest.qualityTiers[quality];
  const tiles: DecodedOwnerTile[] = [];
  const ownerIds = new Set<number>();
  // Sequential decoding limits temporary bitmap/canvas memory to one tile.
  for (const asset of metadata.manifest.ownershipAssets[level][quality]) {
    throwIfAborted(signal);
    const tile = await decodeCityReachOwnerPng(
      await fetchTexture(asset, signal),
      asset,
      metadata.cities.length,
      signal,
    );
    for (const owner of tile.owners) {
      if (owner === 0 || owner === 65535) continue;
      if (ownerIds.has(owner)) continue;
      const city = metadata.cities[owner - 1];
      if (!city || !reviewed(city))
        throw new Error('City reach texture has an unreviewed owner');
      ownerIds.add(owner);
    }
    tiles.push(tile);
  }
  const density =
    sharedDensity ??
    (await decodeCityReachDensityPng(
      await fetchTexture(metadata.manifest.densityAsset, signal),
      metadata.manifest.densityAsset,
      signal,
    ));
  if (density.width !== tier.width || density.height !== tier.height)
    throw new Error('City reach density dimensions disagree with owners');
  throwIfAborted(signal);
  return {
    level,
    quality,
    grid: metadata.manifest.grid,
    stride: tier.stride,
    width: tier.width,
    height: tier.height,
    tiles,
    density,
    ownerIds,
  };
}

export function cityReachPointSelection(
  point: GeoPoint,
  metadata: CityReachMetadata,
  frame: CityReachFrame,
): CityReachPointSelection {
  const { grid } = frame;
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude))
    return { status: 'outside-coverage' };
  const row = Math.floor((grid.north - point.latitude) / grid.step);
  let column = Math.floor((point.longitude - grid.west) / grid.step);
  if (grid.wrapLongitude)
    column = ((column % grid.width) + grid.width) % grid.width;
  if (row < 0 || row >= grid.height || column < 0 || column >= grid.width)
    return { status: 'outside-coverage' };
  const sampleRow = Math.floor(row / frame.stride);
  const sampleColumn = Math.floor(column / frame.stride);
  const tile = frame.tiles.find(
    (candidate) =>
      sampleColumn >= candidate.x &&
      sampleColumn < candidate.x + candidate.width &&
      sampleRow >= candidate.y &&
      sampleRow < candidate.y + candidate.height,
  );
  if (!tile) throw new Error('City reach frame has a missing sample tile');
  const index = (sampleRow - tile.y) * tile.width + sampleColumn - tile.x;
  const owner = tile.owners[index]!;
  const rawDensity =
    frame.density.rgba[(sampleRow * frame.width + sampleColumn) * 4]!;
  const sampled = {
    row: sampleRow,
    column: sampleColumn,
    density: rawDensity === 255 ? null : rawDensity,
  };
  if (owner === 0) return { ...sampled, status: 'unreachable' };
  if (owner === 65535) return { ...sampled, status: 'disputed' };
  const city = metadata.cities[owner - 1];
  if (!city || city.ownerIndex !== owner)
    throw new Error('City reach frame owner disagrees with metadata');
  return { ...sampled, status: 'owned', ownerIndex: owner, city };
}

export function cityReachInspectCity(
  metadata: CityReachMetadata,
  id: number,
): CityReachCity | null {
  const city = metadata.byId.get(id);
  return city && reviewed(city) ? city : null;
}

export function displayCityReachName(
  city: CityReachCity,
  locale: Locale,
): string {
  return locale === 'zh' ? (city.name.zh ?? city.name.en) : city.name.en;
}
export function displayCityReachCountry(
  city: CityReachCity,
  locale: Locale,
): string {
  return locale === 'zh'
    ? (city.country.zh ?? city.country.en)
    : city.country.en;
}

const leadingNamePunctuation = /^(?:[\p{P}\p{S}]|[ʻʿ])+/u;

/** Remove catalog punctuation used by some GHSL labels only for comparison. */
export function cityReachNameSortKey(name: string): string {
  return name.trimStart().replace(leadingNamePunctuation, '').trimStart();
}

export function sortCityReachCities(
  cities: readonly CityReachCity[],
  locale: Locale,
): CityReachCity[] {
  const collator = new Intl.Collator(locale === 'zh' ? 'zh-CN' : 'en');
  return [...cities].sort(
    (a, b) =>
      collator.compare(
        cityReachNameSortKey(displayCityReachName(a, locale)),
        cityReachNameSortKey(displayCityReachName(b, locale)),
      ) || a.id - b.id,
  );
}
