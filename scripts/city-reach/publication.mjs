import { mkdir, readdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { format } from 'prettier';
import { publishAssetSet } from '../publish-asset-set.mjs';
import {
  DEFAULT_LEVEL,
  DISPUTED_OWNER,
  LEVELS,
  MIN_POPULATION,
  QUALITY_TIERS,
  GHSL_SOURCE,
  COUNTRY_SOURCES,
} from './config.mjs';
import { POPULATION_SOURCE } from './sources.mjs';
import { OPEN_BORDER_RULES, ROUTE_MERGES, ROUTE_UNKNOWN } from './policy.mjs';
import { densityTexture, ownershipTiles } from './png.mjs';
import { archiveAndSummarizeCapture } from './source-capture.mjs';
import { sha256 } from './friction.mjs';
import { validateCityAsset, validateCityReachManifest } from './schema.mjs';
import { requireReviewedNames } from './names.mjs';
import {
  CITY_TABLE_FORMAT_VERSION,
  encodeCityTable,
  expandCityTable,
  roundCoordinate,
} from '../../src/features/isolation/cityReachTable.ts';
import { ghslCountryNameZh } from '../../src/features/globe/countryNames.ts';

const roundPoint = (point) =>
  point && {
    latitude: roundCoordinate(point.latitude),
    longitude: roundCoordinate(point.longitude),
  };

export function bytesIdentity(path, bytes) {
  return {
    path,
    sha256: sha256(bytes),
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length,
  };
}

export async function publishCityReach({
  root,
  grid,
  cities,
  names,
  thresholds,
  levelOwners,
  disputed,
  density,
  sourceCapture,
  captureArchiveDirectory,
  retrievedAt,
}) {
  const nameById = new Map(names.map((city) => [city.id, city]));
  const cityAsset = validateCityAsset({
    formatVersion: CITY_TABLE_FORMAT_VERSION,
    referenceYear: 2025,
    universeMinPopulation: MIN_POPULATION,
    cities: cities.map((city) => {
      const named = nameById.get(city.id);
      const threshold = thresholds.get(city.id);
      const isDisputed =
        city.centreCell >= 0 && disputed[city.centreCell] === 1;
      const status = isDisputed ? 'disputed' : threshold.status;
      return {
        id: city.id,
        ownerIndex: city.ownerIndex,
        name: named.name,
        nameMatchType:
          named.matchType ??
          (!named.name.zh ? 'none' : named.hasOverride ? 'override' : 'exact'),
        country: named.country,
        population: city.population,
        point: roundPoint(city.point),
        centrePoint: roundPoint(city.centrePoint),
        threshold: status === 'ok' ? threshold.threshold : null,
        parentId: status === 'ok' ? threshold.parentId : null,
        status,
        mergedIntoId:
          status === 'merged_at_resolution' ? city.mergedIntoId : null,
      };
    }),
  });
  const cityTable = encodeCityTable(cityAsset, cityAsset.cities);
  if (
    !isDeepStrictEqual(expandCityTable(cityTable, ghslCountryNameZh), cityAsset)
  )
    throw new Error('City-reach columnar table does not round-trip');
  const cityBytes = Buffer.from(`${JSON.stringify(cityTable)}\n`);

  const entries = [
    { path: 'src/data/generated/city-reach.json', bytes: cityBytes },
  ];
  const densityOutput = densityTexture({ grid, density }, QUALITY_TIERS.low);
  const densityPath = 'public/data/city-reach/density-low.png';
  const densityAsset = {
    ...bytesIdentity(densityPath, densityOutput.bytes),
    x: densityOutput.x,
    y: densityOutput.y,
    width: densityOutput.width,
    height: densityOutput.height,
  };
  entries.push({ path: densityPath, bytes: densityOutput.bytes });
  const ownershipAssets = {};
  const qualityTiers = {};
  const requiredIds = new Set();
  const byOwner = new Map(cities.map((city) => [city.ownerIndex, city]));
  for (const city of cityAsset.cities) {
    if (city.status === 'root' || city.status === 'no_larger_reachable')
      requiredIds.add(city.id);
    if (city.parentId !== null) requiredIds.add(city.parentId);
  }
  for (const level of LEVELS) {
    ownershipAssets[level] = {};
    const owners = levelOwners.get(level);
    if (!owners || owners.length !== grid.width * grid.height)
      throw new Error(`Missing exact city-reach owner grid at ${level}`);
    for (let cell = 0; cell < owners.length; cell += 1) {
      if (owners[cell] === 0 || disputed[cell]) continue;
      const owner = byOwner.get(owners[cell]);
      if (!owner) throw new Error(`Unknown city-reach owner ${owners[cell]}`);
      requiredIds.add(owner.id);
    }
    for (const [quality, tier] of Object.entries(QUALITY_TIERS)) {
      const output = ownershipTiles({ grid, owners, disputed }, tier);
      qualityTiers[quality] = {
        ...tier,
        width: output.width,
        height: output.height,
        gpuBytes: output.width * output.height * 4,
        densityGpuBytes: output.width * output.height * 4,
        cpuOwnerBytes: output.width * output.height * 2,
        transitionGpuBytes: output.width * output.height * 12,
      };
      ownershipAssets[level][quality] = output.tiles.map((tile) => {
        const path = `public/data/city-reach/population-${level}-${quality}-${tile.tileRow}-${tile.tileColumn}.png`;
        entries.push({ path, bytes: tile.bytes });
        return {
          ...bytesIdentity(path, tile.bytes),
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
        };
      });
    }
  }
  const nameAudit = await requireReviewedNames(
    names,
    requiredIds,
    resolve(root, 'tmp/city-reach/name-review.json'),
  );
  const { summary, archivePath } = await archiveAndSummarizeCapture(
    sourceCapture,
    grid,
    requiredIds,
    captureArchiveDirectory,
  );
  const captureBytes = Buffer.from(`${JSON.stringify(summary)}\n`);
  const sourceSummaryPath = 'src/data/generated/city-reach-source-summary.json';
  entries.push({ path: sourceSummaryPath, bytes: captureBytes });
  const manifest = validateCityReachManifest({
    id: 'city-reach',
    formatVersion: 1,
    sourceName: 'Traffic-weighted city competition field',
    sourceUrl:
      'https://malariaatlas.org/research-project/accessibility-to-cities/',
    licenseName: 'CC BY 4.0 and public domain',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    version: 'MAP 2019 / GHSL R2024A V1.1 / NE 5.1.2 / GHS-POP R2023A',
    retrievedAt,
    attribution:
      'MAP: Weiss et al. (2020), Nature Medicine, DOI 10.1038/s41591-020-1059-1; © OpenStreetMap contributors; GHSL: European Commission Joint Research Centre; Made with Natural Earth; Contains GeoNames data, CC BY 4.0',
    redistribution: 'allowed',
    transformations: [
      'Minimum valid nonwater MAP friction over each 4×4 pixel block',
      'Centre-in-polygon Natural Earth labels with owner-reviewed routing table and disputed mask',
      'GHSL population >=100,000; all_touched urban footprints, larger population wins overlaps, majority routing-country clipping',
      'UC_centroids with nearest retained source-cell fallback',
      'Fixed population additive lead and deterministic (distance, -population, GHSL id) ties',
      'Exact bounded centre-switch threshold search; no ferries',
      'Single 15 km display tier; RGB8 owner PNGs with B = 0 and a separate shared RGB8 quantised 2020 density texture',
    ],
    missingValuePolicy:
      '0 means no reachable city; 65535 means disputed. A city with no transport source, no larger reachable centre, or a resolution merge keeps a distinct status. Missing reviewed Chinese city names remain null and the Chinese UI falls back to English. Required English city names and Chinese names for every asset country are mandatory; missing Chinese city-name counts are recorded.',
    boundaryPolicy:
      'Drawn countries use Mundus China viewpoint with Taiwan separate; routing uses Natural Earth default de facto polygons. Unknown land inherits the nearest known country without longitude wrapping. Nonlisted cross-border edges are closed; water and ferries are impassable.',
    grid,
    levels: LEVELS,
    defaultLevel: DEFAULT_LEVEL,
    defaultQuality: 'low',
    universeMinPopulation: MIN_POPULATION,
    ownerEncoding: {
      format: 'RGB8: R + 256 * G; B = 0',
      cityIndexOffset: 1,
      unreachable: 0,
      disputed: DISPUTED_OWNER,
    },
    densityEncoding: {
      format: 'RGB8: R = log-density; G = B = 0',
      year: 2020,
      unit: 'people/km²',
      transform: 'round(254 * min(1, log10(1 + density) / 4)); 255 = missing',
      missing: 255,
      source: 'GHS-POP R2023A',
    },
    densityAsset,
    cityAsset: {
      ...bytesIdentity(entries[0].path, cityBytes),
      formatVersion: CITY_TABLE_FORMAT_VERSION,
    },
    sourceCapture: bytesIdentity(sourceSummaryPath, captureBytes),
    sourceAssets: {
      ghsl: { distributionUrl: GHSL_SOURCE.url, sha256: GHSL_SOURCE.sha256 },
      neDrawn: {
        distributionUrl: COUNTRY_SOURCES.drawn.url,
        sha256: COUNTRY_SOURCES.drawn.sha256,
      },
      neRoute: {
        distributionUrl: COUNTRY_SOURCES.route.url,
        sha256: COUNTRY_SOURCES.route.sha256,
      },
      population: {
        distributionUrl: POPULATION_SOURCE.url,
        sha256: POPULATION_SOURCE.sha256,
      },
    },
    openBorderRules: OPEN_BORDER_RULES,
    routeMerges: ROUTE_MERGES,
    routeUnknown: ROUTE_UNKNOWN,
    qualityTiers,
    ownershipAssets,
    recordCount: cityAsset.cities.length,
    nameReview: nameAudit.nameReview,
  });
  const manifestPath = 'src/data/manifests/city-reach.json';
  entries.push({
    path: manifestPath,
    bytes: Buffer.from(
      await format(JSON.stringify(manifest), { parser: 'json' }),
    ),
  });
  const absolute = entries.map((entry) => ({
    ...entry,
    path: resolve(root, entry.path),
  }));
  for (const entry of absolute)
    await mkdir(dirname(entry.path), { recursive: true });
  await publishAssetSet(absolute);
  const publishedPaths = new Set(
    entries.map((entry) => resolve(root, entry.path)),
  );
  const textureDirectory = resolve(root, 'public/data/city-reach');
  for (const name of await readdir(textureDirectory)) {
    const path = resolve(textureDirectory, name);
    if (name.endsWith('.png') && !publishedPaths.has(path)) await rm(path);
  }
  await rm(resolve(root, 'src/data/generated/city-reach-source-capture.json'), {
    force: true,
  });
  return { manifest, cityAsset, sourceCaptureArchivePath: archivePath };
}
