import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const INPUT_PATH = resolve(
  ROOT,
  'src/data/generated/urban-isolation-input.json',
);
const ASSET_PATH = resolve(ROOT, 'src/data/generated/urban-isolation.json');
const MANIFEST_PATH = resolve(ROOT, 'src/data/manifests/urban-isolation.json');
const REPORT_PATH = resolve(ROOT, 'tmp/urban-isolation-report.md');

export const SOURCE_PACKAGE_SHA256 =
  '7b644df16b0791f88c3db28ce56338b5e1725be02b6a79ca253849822db26b21';
export const CAPTURE_CSV_SHA256 =
  'c122f1fdc8a9da3fdbe83ddb356fadf28b6baa305d7f0d04cce0fde9649ab2d4';
export const SOURCE_URL =
  'https://cidportal.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_UCDB_GLOBE_R2024A/GHS_UCDB_GLOBE_R2024A/V1-1/GHS_UCDB_GLOBE_R2024A_V1_1.zip';
export const SOURCE_PAGE =
  'https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php';
export const RETRIEVED_AT = '2026-10-08';
export const CSV_HEADERS = [
  'ID_UC_G0',
  'GC_UCN_MAI_2025',
  'GC_CNT_GAD_2025',
  'GC_POP_TOT_2025',
  'GC_UCC_LON_2025',
  'GC_UCC_LAT_2025',
];

const { ALPHA_MIN, ALPHA_MAX, recordHolders, competitorAt, rankingAt } =
  await import('../src/features/isolation/isolationMetric.ts');

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows.shift();
  return rows.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    ),
  );
}

export function mollweideToWgs84(x, y) {
  const radius = 6378137;
  const theta = Math.asin(y / (Math.SQRT2 * radius));
  const latitude = Math.asin((2 * theta + Math.sin(2 * theta)) / Math.PI);
  const longitude = (Math.PI * x) / (2 * Math.SQRT2 * radius * Math.cos(theta));
  return {
    latitude: (latitude * 180) / Math.PI,
    longitude: (longitude * 180) / Math.PI,
  };
}

export function checkBudget(rawBytes, gzipBytes) {
  if (rawBytes > 400 * 1024 || gzipBytes > 120 * 1024) {
    throw new Error(
      `Urban Isolation asset budget exceeded: ${rawBytes} raw, ${gzipBytes} gzip`,
    );
  }
}

function roundCoordinate(value) {
  return Math.round(value * 10_000) / 10_000;
}

function clean(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
}

export function captureCsv(text, expectedHash = CAPTURE_CSV_SHA256) {
  const bytes = Buffer.from(text, 'utf8');
  const actualHash = sha256(bytes);
  if (expectedHash && actualHash !== expectedHash) {
    throw new Error(
      `Urban Isolation CSV SHA-256 mismatch: expected ${expectedHash}, received ${actualHash}`,
    );
  }
  const parsed = parseCsv(text);
  if (!parsed.length) throw new Error('Urban Isolation CSV is empty');
  const missing = CSV_HEADERS.filter((header) => !(header in parsed[0]));
  if (missing.length)
    throw new Error(
      `Urban Isolation CSV missing columns: ${missing.join(', ')}`,
    );

  const seen = new Set();
  const rows = [];
  for (const row of parsed) {
    const id = clean(row.ID_UC_G0);
    const name = clean(row.GC_UCN_MAI_2025);
    const countryName = clean(row.GC_CNT_GAD_2025);
    const population = Number(row.GC_POP_TOT_2025);
    const x = Number(row.GC_UCC_LON_2025);
    const y = Number(row.GC_UCC_LAT_2025);
    if (!Number.isFinite(population) || population < 100_000) continue;
    if (!id || seen.has(id))
      throw new Error(`Invalid or duplicate urban-centre id: ${id}`);
    if (!Number.isFinite(population) || population <= 0)
      throw new Error(`Invalid population for ${id}`);
    if (!name && population >= 1_000_000)
      throw new Error(`Missing name for focal urban centre ${id}`);
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error(`Missing centroid for ${id}`);
    const point = mollweideToWgs84(x, y);
    if (
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      point.latitude < -90 ||
      point.latitude > 90 ||
      point.longitude < -180 ||
      point.longitude > 180
    )
      throw new Error(`Invalid centroid for ${id}`);
    seen.add(id);
    rows.push([
      id,
      name,
      countryName,
      null,
      population,
      roundCoordinate(point.latitude),
      roundCoordinate(point.longitude),
    ]);
  }
  rows.sort((left, right) => left[0].localeCompare(right[0], 'en'));
  return {
    schemaVersion: 1,
    source: {
      sourceName: 'GHS-UCDB R2024A - GHS Urban Centre Database 2025',
      sourceUrl: SOURCE_PAGE,
      distributionUrl: SOURCE_URL,
      licenseName: 'CC BY 4.0',
      version: 'V1_1',
      releaseDate: '2025-07-31',
      packageSha256: SOURCE_PACKAGE_SHA256,
      csvSha256: actualHash,
      coordinateReferenceSystem: 'EPSG:54009',
    },
    rows,
  };
}

function normalize(value) {
  return clean(value)
    .toLocaleLowerCase('und')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchNames(city, geoNames, overrides = {}) {
  const override = overrides[city.id];
  if (override) {
    return {
      nameZh: override.nameZh ?? null,
      countryZh: override.countryZh ?? null,
      matchType: 'override',
      matchDistanceKm: null,
    };
  }
  const normalizedName = normalize(city.name);
  const exact = geoNames
    .filter(
      (candidate) =>
        candidate.distanceKm <= 50 &&
        normalize(candidate.nameEn) === normalizedName,
    )
    .sort(
      (a, b) =>
        a.distanceKm - b.distanceKm ||
        b.population - a.population ||
        a.id.localeCompare(b.id),
    )[0];
  if (exact) {
    return {
      nameZh: exact.nameZhFallback ? null : exact.nameZh,
      countryZh: exact.countryZh ?? null,
      matchType: 'exact',
      matchDistanceKm: exact.distanceKm,
    };
  }
  const proximity = geoNames
    .filter((candidate) => candidate.distanceKm <= 30)
    .sort(
      (a, b) =>
        b.population - a.population ||
        a.distanceKm - b.distanceKm ||
        a.id.localeCompare(b.id),
    )[0];
  if (proximity) {
    return {
      nameZh: proximity.nameZhFallback ? null : proximity.nameZh,
      countryZh: proximity.countryZh ?? null,
      matchType: 'proximity',
      matchDistanceKm: proximity.distanceKm,
    };
  }
  return {
    nameZh: null,
    countryZh: null,
    matchType: 'none',
    matchDistanceKm: null,
  };
}

async function loadGeoNamesSnapshot() {
  const raw = JSON.parse(
    await readFile(
      resolve(ROOT, 'src/data/generated/geonames-major-cities.json'),
      'utf8',
    ),
  );
  const strings = raw.strings;
  const cities = raw.rows.map((row) => ({
    id: String(row[0]),
    latitude: row[1] / 100_000,
    longitude: row[2] / 100_000,
    population: row[3],
    nameEn: strings[row[6]],
    nameZh: strings[row[7]],
    countryEn: strings[row[8]],
    countryZh: strings[row[9]],
    nameZhFallback: (row[13] & 1) === 1,
  }));
  return cities;
}

async function buildOffline(input) {
  const cities = input.rows.map(
    ([id, name, countryName, countryIso, population, latitude, longitude]) => ({
      id,
      name,
      countryName,
      countryIso,
      population,
      latitude,
      longitude,
    }),
  );
  const focalIndices = cities
    .map((city, index) => (city.population >= 1_000_000 ? index : -1))
    .filter((index) => index >= 0);
  if (focalIndices.length === 0)
    throw new Error('Urban Isolation has no focal cities');
  const minFocalPopulation = Math.min(
    ...focalIndices.map((index) => cities[index].population),
  );
  if (ALPHA_MIN * minFocalPopulation < 100_000)
    throw new Error('Urban Isolation completeness invariant failed');
  const metricCities = cities.map((city) => ({
    id: city.id,
    latitude: city.latitude,
    longitude: city.longitude,
    population: city.population,
  }));
  const holderLists = cities.map(() => null);
  const referenced = new Set(focalIndices);
  for (const focalIndex of focalIndices) {
    const holders = recordHolders(focalIndex, metricCities);
    holderLists[focalIndex] = holders;
    holders.forEach((holder) => referenced.add(holder.index));
  }
  const geoNames = await loadGeoNamesSnapshot();
  const { ISOLATION_NAME_OVERRIDES } =
    await import('../src/features/isolation/isolationNameOverrides.ts');
  const geonameCandidates = [];
  const { haversineKm } =
    await import('../src/features/isolation/isolationMetric.ts');
  const nameMatches = new Map();
  for (const index of referenced) {
    const city = cities[index];
    const candidates = geoNames.map((candidate) => ({
      ...candidate,
      distanceKm: haversineKm(city, candidate),
    }));
    const match = matchNames(city, candidates, ISOLATION_NAME_OVERRIDES);
    nameMatches.set(index, match);
    geonameCandidates.push({ city, match });
  }
  const sortedIndices = [...referenced].sort((a, b) =>
    cities[a].id.localeCompare(cities[b].id, 'en'),
  );
  const outputIndex = new Map(
    sortedIndices.map((inputIndex, index) => [inputIndex, index]),
  );
  const strings = [];
  const stringIndex = new Map();
  const intern = (value) => {
    if (value === null) return null;
    if (!stringIndex.has(value)) {
      stringIndex.set(value, strings.length);
      strings.push(value);
    }
    return stringIndex.get(value);
  };
  const outputCities = sortedIndices.map((inputIndex) => {
    const city = cities[inputIndex];
    const match = nameMatches.get(inputIndex);
    return [
      city.id,
      Math.round(city.latitude * 10_000),
      Math.round(city.longitude * 10_000),
      city.population,
      intern(city.name),
      intern(match?.nameZh ?? null),
      intern(city.countryName),
      intern(match?.countryZh ?? null),
      focalIndices.includes(inputIndex),
    ];
  });
  const holders = outputCities.map(() => null);
  for (const focalIndex of focalIndices) {
    const outputFocal = outputIndex.get(focalIndex);
    holders[outputFocal] = holderLists[focalIndex].map((holder) => [
      outputIndex.get(holder.index),
      Math.round(holder.distanceKm),
    ]);
  }
  const asset = {
    formatVersion: 1,
    referenceYear: 2025,
    focalMinPopulation: 1_000_000,
    universeMinPopulation: 100_000,
    strings,
    cities: outputCities,
    holders,
  };
  const assetBytes = Buffer.from(`${JSON.stringify(asset)}\n`);
  const gzipBytes = gzipSync(assetBytes, { level: 9, mtime: 0 }).byteLength;
  checkBudget(assetBytes.byteLength, gzipBytes);
  const inputBytes = Buffer.from(`${JSON.stringify(input)}\n`);
  const manifest = {
    id: 'urban-isolation',
    sourceName: input.source.sourceName,
    sourceUrl: input.source.sourceUrl,
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    version: 'R2024A V1_1',
    retrievedAt: RETRIEVED_AT,
    attribution:
      'GHS-UCDB R2024A - GHS Urban Centre Database 2025. European Commission, Joint Research Centre (JRC) [Dataset], DOI 10.2905/1a338be6-7eaf-480c-9664-3a8ade88cbcd',
    redistribution: 'allowed',
    transformations: [
      'Filtered 2025 population >= 100,000',
      'Converted EPSG:54009 Mollweide centroids to WGS84 degrees',
      'Precomputed hierarchical record holders',
      'Attached reviewed GeoNames Chinese names at build time',
    ],
    missingValuePolicy:
      'Missing Chinese names and country ISO codes remain null; empty sub-million names are dropped during capture.',
    boundaryPolicy:
      'Cities are GHSL urban centres; no runtime geographic boundary matching is performed.',
    recordCount: outputCities.length,
    rawBytes: assetBytes.byteLength,
    gzipBytes,
    immutableBuildInput: {
      path: 'src/data/generated/urban-isolation-input.json',
      schemaVersion: 1,
      sha256: sha256(inputBytes),
      rawBytes: inputBytes.byteLength,
    },
    derivedAsset: {
      path: 'src/data/generated/urban-isolation.json',
      sha256: sha256(assetBytes),
      rawBytes: assetBytes.byteLength,
      formatVersion: 1,
    },
    sourceAssets: {
      csv: { distributionUrl: SOURCE_URL, sha256: input.source.csvSha256 },
    },
  };
  await mkdir(dirname(INPUT_PATH), { recursive: true });
  await writeFile(INPUT_PATH, inputBytes);
  await writeFile(ASSET_PATH, assetBytes);
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    REPORT_PATH,
    createReport(
      cities,
      focalIndices,
      holderLists,
      geonameCandidates,
      asset,
      manifest,
    ),
  );
  return { input, asset, manifest, reportPath: REPORT_PATH };
}

function createReport(
  cities,
  focalIndices,
  holderLists,
  nameMatches,
  asset,
  manifest,
) {
  const lines = [
    `# Urban Isolation build report`,
    '',
    `- Focal cities: ${focalIndices.length}`,
    `- Competitor universe: ${cities.length}`,
    `- Referenced competitors: ${asset.cities.length - focalIndices.length}`,
    `- Asset: ${manifest.rawBytes} raw bytes; ${manifest.gzipBytes} gzip bytes`,
    '',
  ];
  for (const alpha of [0.1, 0.5, 1]) {
    const ranking = rankingAt(
      focalIndices,
      cities.map((city) => ({
        id: city.id,
        latitude: city.latitude,
        longitude: city.longitude,
        population: city.population,
      })),
      holderLists,
      alpha,
    ).slice(0, 20);
    lines.push(
      `## Top 20 at alpha = ${alpha.toFixed(2)}`,
      '',
      '| City | Country | Population | Competitor | km |',
      '| --- | --- | ---: | --- | ---: |',
    );
    for (const entry of ranking) {
      const focal = cities[entry.index];
      const holder = competitorAt(
        holderLists[entry.index],
        cities.map((city) => city.population),
        focal.population,
        alpha,
      );
      const competitor = holder ? cities[holder.index] : null;
      lines.push(
        `| ${focal.name} | ${focal.countryName} | ${Math.round(focal.population)} | ${competitor?.name ?? 'none'} | ${Math.round(entry.distanceKm)} |`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## Name review',
    '',
    '| GHSL id | English name | Chinese name | Match | Distance km |',
    '| --- | --- | --- | --- | ---: |',
  );
  for (const item of nameMatches)
    lines.push(
      `| ${item.city.id} | ${item.city.name} | ${item.match.nameZh ?? ''} | ${item.match.matchType} | ${item.match.matchDistanceKm === null ? '' : item.match.matchDistanceKm.toFixed(2)} |`,
    );
  return `${lines.join('\n')}\n`;
}

async function main() {
  const captureIndex = process.argv.indexOf('--capture');
  if (captureIndex >= 0) {
    const csvPath = process.argv[captureIndex + 1];
    if (!csvPath) throw new Error('--capture requires a CSV path');
    const text = await readFile(resolve(csvPath), 'utf8');
    const input = captureCsv(text);
    const bytes = Buffer.from(`${JSON.stringify(input)}\n`);
    await mkdir(dirname(INPUT_PATH), { recursive: true });
    await writeFile(INPUT_PATH, bytes);
    const existing = await readManifestIfPresent();
    const manifest = existing ?? { immutableBuildInput: {} };
    manifest.immutableBuildInput = {
      path: 'src/data/generated/urban-isolation-input.json',
      schemaVersion: 1,
      sha256: sha256(bytes),
      rawBytes: bytes.byteLength,
    };
    manifest.sourceAssets = {
      csv: { distributionUrl: SOURCE_URL, sha256: input.source.csvSha256 },
    };
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Captured ${input.rows.length} rows into ${INPUT_PATH}`);
    return;
  }
  const inputBytes = await readFile(INPUT_PATH);
  const input = JSON.parse(inputBytes.toString('utf8'));
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  if (sha256(inputBytes) !== manifest.immutableBuildInput?.sha256)
    throw new Error('Urban Isolation immutable input SHA-256 mismatch');
  await buildOffline(input);
  console.log(`Built ${ASSET_PATH}`);
}

async function readManifestIfPresent() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

export { buildOffline };
