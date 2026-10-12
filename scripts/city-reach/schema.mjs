import {
  DEFAULT_LEVEL,
  DISPUTED_OWNER,
  LEVELS,
  MAX_OWNER,
  MAX_TEXTURE_BYTES,
  MIN_POPULATION,
  QUALITY_TIERS,
  GHSL_SOURCE,
  COUNTRY_SOURCES,
} from './config.mjs';
import { POPULATION_SOURCE } from './sources.mjs';
import { validateGrid } from './grid.mjs';
import { OPEN_BORDER_RULES, ROUTE_MERGES, ROUTE_UNKNOWN } from './policy.mjs';

export const CITY_STATUSES = Object.freeze([
  'ok',
  'root',
  'no_larger_reachable',
  'merged_at_resolution',
  'transport_missing',
  'disputed',
]);
const hash = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateCityAsset(asset) {
  if (
    asset?.formatVersion !== 1 ||
    asset.referenceYear !== 2025 ||
    asset.universeMinPopulation !== MIN_POPULATION ||
    !Array.isArray(asset.cities) ||
    asset.cities.length > MAX_OWNER
  )
    throw new Error('Invalid city-reach city table header');
  const byId = new Map();
  for (let index = 0; index < asset.cities.length; index += 1) {
    const city = asset.cities[index];
    if (
      !Number.isInteger(city.id) ||
      city.id <= 0 ||
      byId.has(city.id) ||
      city.ownerIndex !== index + 1 ||
      !Number.isFinite(city.population) ||
      city.population < MIN_POPULATION ||
      !CITY_STATUSES.includes(city.status) ||
      typeof city.name?.en !== 'string' ||
      !['override', 'exact', 'none'].includes(city.nameMatchType) ||
      (city.name.zh !== null && typeof city.name.zh !== 'string') ||
      (city.nameMatchType === 'none'
        ? city.name.zh !== null
        : !city.name.zh?.trim()) ||
      typeof city.country?.en !== 'string' ||
      !city.country.en.trim() ||
      typeof city.country.zh !== 'string' ||
      !city.country.zh.trim() ||
      !Number.isFinite(city.point?.latitude) ||
      Math.abs(city.point.latitude) > 90 ||
      !Number.isFinite(city.point?.longitude) ||
      Math.abs(city.point.longitude) > 180
    )
      throw new Error(`Invalid city-reach city ${String(city?.id)}`);
    if (
      city.status === 'ok'
        ? !Number.isFinite(city.threshold) ||
          city.threshold < 0 ||
          !Number.isInteger(city.parentId)
        : city.threshold !== null || city.parentId !== null
    )
      throw new Error(`Invalid threshold state for city ${city.id}`);
    if (
      city.status === 'merged_at_resolution'
        ? !Number.isInteger(city.mergedIntoId)
        : city.mergedIntoId !== null
    )
      throw new Error(`Invalid merged state for city ${city.id}`);
    byId.set(city.id, city);
  }
  for (const city of asset.cities) {
    if (
      city.parentId !== null &&
      (!byId.has(city.parentId) ||
        byId.get(city.parentId).population <= city.population)
    )
      throw new Error(`Invalid city-reach parent for ${city.id}`);
    if (
      city.mergedIntoId !== null &&
      (!byId.has(city.mergedIntoId) || city.mergedIntoId === city.id)
    )
      throw new Error(`Invalid merged target for ${city.id}`);
  }
  return asset;
}

function assetIdentity(entry) {
  return (
    entry &&
    typeof entry.path === 'string' &&
    /^(src\/data\/generated|public\/data\/city-reach)\/[a-zA-Z0-9_./-]+$/.test(
      entry.path,
    ) &&
    !entry.path.split('/').includes('..') &&
    hash(entry.sha256) &&
    Number.isInteger(entry.rawBytes) &&
    entry.rawBytes > 0 &&
    Number.isInteger(entry.gzipBytes) &&
    entry.gzipBytes > 0
  );
}

export function validateCityReachManifest(manifest) {
  if (
    manifest?.id !== 'city-reach' ||
    manifest.formatVersion !== 1 ||
    manifest.defaultLevel !== DEFAULT_LEVEL ||
    JSON.stringify(manifest.levels) !== JSON.stringify(LEVELS) ||
    manifest.universeMinPopulation !== MIN_POPULATION ||
    manifest.defaultQuality !== 'low' ||
    !assetIdentity(manifest.cityAsset) ||
    !assetIdentity(manifest.sourceCapture) ||
    !assetIdentity(manifest.densityAsset)
  )
    throw new Error('Invalid city-reach manifest header or asset identity');
  const review = manifest.nameReview;
  if (
    !Number.isInteger(manifest.recordCount) ||
    manifest.recordCount < 0 ||
    manifest.recordCount > MAX_OWNER ||
    !review ||
    !Number.isInteger(review.requiredCityCount) ||
    review.requiredCityCount < 0 ||
    review.requiredCityCount > manifest.recordCount ||
    !Number.isInteger(review.missingChineseCityCount) ||
    review.missingChineseCityCount < 0 ||
    review.missingChineseCityCount > manifest.recordCount ||
    !Number.isInteger(review.requiredMissingChineseCityCount) ||
    review.requiredMissingChineseCityCount < 0 ||
    review.requiredMissingChineseCityCount > review.requiredCityCount ||
    review.requiredMissingChineseCityCount > review.missingChineseCityCount ||
    ['override', 'exact', 'none'].some(
      (type) =>
        !Number.isInteger(review.matchCounts?.[type]) ||
        review.matchCounts[type] < 0,
    ) ||
    review.matchCounts.override +
      review.matchCounts.exact +
      review.matchCounts.none !==
      manifest.recordCount ||
    review.matchCounts.none !== review.missingChineseCityCount
  )
    throw new Error('Invalid city-reach name review counts');
  validateGrid(manifest.grid);
  for (const [key, source] of Object.entries({
    ghsl: GHSL_SOURCE,
    neDrawn: COUNTRY_SOURCES.drawn,
    neRoute: COUNTRY_SOURCES.route,
    population: POPULATION_SOURCE,
  })) {
    if (
      manifest.sourceAssets?.[key]?.distributionUrl !== source.url ||
      manifest.sourceAssets?.[key]?.sha256 !== source.sha256
    )
      throw new Error(`Unpinned city-reach source ${key}`);
  }
  if (
    JSON.stringify(manifest.openBorderRules) !==
      JSON.stringify(OPEN_BORDER_RULES) ||
    JSON.stringify(manifest.routeMerges) !== JSON.stringify(ROUTE_MERGES) ||
    JSON.stringify(manifest.routeUnknown) !== JSON.stringify(ROUTE_UNKNOWN)
  )
    throw new Error(
      'City-reach routing policy differs from the reviewed policy',
    );
  if (
    manifest.densityEncoding?.format !== 'RGB8: R = log-density; G = B = 0' ||
    manifest.densityEncoding.missing !== 255 ||
    manifest.densityEncoding.year !== 2020 ||
    manifest.densityEncoding.unit !== 'people/km²' ||
    manifest.densityEncoding.source !== 'GHS-POP R2023A' ||
    manifest.densityEncoding.transform !==
      'round(254 * min(1, log10(1 + density) / 4)); 255 = missing'
  )
    throw new Error('Invalid city-reach missing density encoding');
  if (
    manifest.ownerEncoding?.cityIndexOffset !== 1 ||
    manifest.ownerEncoding.unreachable !== 0 ||
    manifest.ownerEncoding.disputed !== DISPUTED_OWNER ||
    manifest.ownerEncoding.format !== 'RGB8: R + 256 * G; B = 0'
  )
    throw new Error('Invalid city-reach owner encoding');
  if (
    typeof manifest.missingValuePolicy !== 'string' ||
    !manifest.missingValuePolicy.trim() ||
    typeof manifest.boundaryPolicy !== 'string' ||
    !manifest.boundaryPolicy.trim()
  )
    throw new Error('City-reach missing/boundary policy is required');
  const seenPaths = new Set([
    manifest.cityAsset.path,
    manifest.sourceCapture.path,
    manifest.densityAsset.path,
  ]);
  if (
    seenPaths.size !== 3 ||
    JSON.stringify(Object.keys(manifest.qualityTiers ?? {})) !==
      JSON.stringify(['low'])
  )
    throw new Error(
      'City-reach must publish only the approved low display tier',
    );
  if (
    JSON.stringify(Object.keys(manifest.ownershipAssets ?? {}).sort()) !==
    JSON.stringify(LEVELS.map(String).sort())
  )
    throw new Error(
      'City-reach ownership assets must contain exactly the approved levels',
    );
  let textureBytes = manifest.densityAsset.rawBytes;
  for (const [quality, expectedTier] of Object.entries(QUALITY_TIERS)) {
    const tier = manifest.qualityTiers?.[quality];
    if (
      !tier ||
      tier.stride !== expectedTier.stride ||
      tier.width !== Math.ceil(manifest.grid.width / expectedTier.stride) ||
      tier.height !== Math.ceil(manifest.grid.height / expectedTier.stride) ||
      tier.gpuBytes !== tier.width * tier.height * 4 ||
      tier.densityGpuBytes !== tier.width * tier.height * 4 ||
      tier.cpuOwnerBytes !== tier.width * tier.height * 2 ||
      tier.transitionGpuBytes !== tier.width * tier.height * 12
    )
      throw new Error(`Invalid city-reach quality budget ${quality}`);
    if (
      manifest.densityAsset.x !== 0 ||
      manifest.densityAsset.y !== 0 ||
      manifest.densityAsset.width !== tier.width ||
      manifest.densityAsset.height !== tier.height ||
      tier.width > 4096 ||
      tier.height > 4096
    )
      throw new Error('Invalid shared city-reach density texture');
    for (const level of LEVELS) {
      const tiles = manifest.ownershipAssets?.[String(level)]?.[quality];
      if (
        JSON.stringify(
          Object.keys(manifest.ownershipAssets?.[String(level)] ?? {}),
        ) !== JSON.stringify(['low']) ||
        !Array.isArray(tiles) ||
        tiles.length !== 1
      )
        throw new Error(`Missing city-reach texture level ${level}/${quality}`);
      let pixels = 0;
      const rectangles = [];
      for (const tile of tiles) {
        if (
          !assetIdentity(tile) ||
          seenPaths.has(tile.path) ||
          !Number.isInteger(tile.width) ||
          !Number.isInteger(tile.height) ||
          tile.width <= 0 ||
          tile.height <= 0 ||
          tile.width > 4096 ||
          tile.height > 4096 ||
          !Number.isInteger(tile.x) ||
          !Number.isInteger(tile.y) ||
          tile.x < 0 ||
          tile.y < 0 ||
          tile.x + tile.width > tier.width ||
          tile.y + tile.height > tier.height
        )
          throw new Error(`Invalid city-reach texture ${tile?.path}`);
        for (const other of rectangles)
          if (
            tile.x < other.x + other.width &&
            tile.x + tile.width > other.x &&
            tile.y < other.y + other.height &&
            tile.y + tile.height > other.y
          )
            throw new Error(`Overlapping city-reach texture ${tile.path}`);
        rectangles.push(tile);
        seenPaths.add(tile.path);
        textureBytes += tile.rawBytes;
        pixels += tile.width * tile.height;
      }
      if (pixels !== tier.width * tier.height)
        throw new Error(`Incomplete city-reach tiles ${level}/${quality}`);
    }
  }
  if (textureBytes > MAX_TEXTURE_BYTES)
    throw new Error(
      'City-reach total PNG bytes exceed the 3 MB texture budget',
    );
  return manifest;
}

export function allManifestAssets(manifest) {
  validateCityReachManifest(manifest);
  return [
    manifest.cityAsset,
    manifest.sourceCapture,
    manifest.densityAsset,
    ...Object.values(manifest.ownershipAssets).flatMap((level) =>
      Object.values(level).flat(),
    ),
  ];
}
