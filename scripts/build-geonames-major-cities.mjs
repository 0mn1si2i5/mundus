import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from 'node:zlib';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import OpenCC from 'opencc-js';
import { publishAssetSet } from './publish-asset-set.mjs';

const ACTIVE_CODES = new Set([
  'PPL',
  'PPLA',
  'PPLA2',
  'PPLA3',
  'PPLA4',
  'PPLC',
  'PPLG',
]);
const LANGUAGE_RANK = new Map([
  ['zh-CN', 0],
  ['zh-Hans', 1],
  ['zh', 2],
]);
const traditionalToSimplified = OpenCC.Converter({ from: 't', to: 'cn' });
const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;
const SOURCE_DEFINITIONS = [
  ['GeoNames cities15000', 'cities15000.zip'],
  ['GeoNames alternate names V2', 'alternateNamesV2.zip'],
  ['GeoNames country info', 'countryInfo.txt'],
  ['GeoNames admin-1 codes', 'admin1CodesASCII.txt'],
  ['GeoNames dump readme', 'readme.txt'],
].map(([sourceName, fileName]) => ({
  sourceName,
  fileName,
  distributionUrl: `https://download.geonames.org/export/dump/${fileName}`,
}));

export function parseCityRow(line) {
  const columns = line.split('\t');
  if (columns.length !== 19) return null;
  const [
    id,
    canonicalName,
    asciiName,
    aliases,
    latitude,
    longitude,
    featureClass,
    featureCode,
    countryCode,
    ,
    admin1Code,
    ,
    ,
    ,
    population,
  ] = columns;
  const parsed = {
    id: Number(id),
    canonicalName,
    asciiName,
    sourceAliases: aliases ? aliases.split(',').filter(Boolean) : [],
    latitude: Number(latitude),
    longitude: Number(longitude),
    featureClass,
    featureCode,
    countryCode,
    admin1Code,
    population: Number(population),
  };
  if (
    !Number.isSafeInteger(parsed.id) ||
    !canonicalName ||
    !Number.isFinite(parsed.latitude) ||
    Math.abs(parsed.latitude) > 90 ||
    !Number.isFinite(parsed.longitude) ||
    Math.abs(parsed.longitude) > 180 ||
    !Number.isFinite(parsed.population)
  ) {
    return null;
  }
  return parsed;
}

export function isEligibleCity(city) {
  return Boolean(
    city &&
    city.featureClass === 'P' &&
    ACTIVE_CODES.has(city.featureCode) &&
    (city.featureCode === 'PPLC' ||
      city.featureCode === 'PPLA' ||
      city.population >= 100_000),
  );
}

export function hasExactJoins(city, countries, admin1) {
  return Boolean(
    city &&
    city.admin1Code &&
    countries.has(city.countryCode) &&
    admin1.has(`${city.countryCode}.${city.admin1Code}`),
  );
}

export function parseAlternateNameRow(line) {
  const columns = line.split('\t');
  if (columns.length < 10) return null;
  const [
    id,
    geoNameId,
    language,
    name,
    preferred,
    short,
    colloquial,
    historic,
    from,
    to,
  ] = columns;
  if (
    !name ||
    short === '1' ||
    colloquial === '1' ||
    historic === '1' ||
    from ||
    to
  ) {
    return null;
  }
  const parsed = {
    id: Number(id),
    geoNameId: Number(geoNameId),
    language,
    name,
    preferred: preferred === '1',
  };
  return Number.isSafeInteger(parsed.id) &&
    Number.isSafeInteger(parsed.geoNameId)
    ? parsed
    : null;
}

export function parseCountryRow(line) {
  if (!line || line.startsWith('#')) return null;
  const columns = line.split('\t');
  const parsed = {
    code: columns[0],
    name: columns[4],
    geoNameId: Number(columns[16]),
  };
  return /^[A-Z]{2}$/.test(parsed.code) &&
    parsed.name &&
    Number.isSafeInteger(parsed.geoNameId)
    ? parsed
    : null;
}

export function parseAdmin1Row(line) {
  const [key, name, , id] = line.split('\t');
  const parsed = { key, name, geoNameId: Number(id) };
  return key?.includes('.') && name && Number.isSafeInteger(parsed.geoNameId)
    ? parsed
    : null;
}

export function chooseLocalizedNames(canonicalName, names) {
  const current = [...names].sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      a.id - b.id ||
      a.name.localeCompare(b.name, 'und'),
  );
  const en = current.find((name) => name.language === 'en')?.name;
  // Some Chinese-language records are romanizations ("Duīlóngdéqìng Qū");
  // only a value with Han characters can be the Chinese display name.
  const zh = current
    .filter((name) => LANGUAGE_RANK.has(name.language) && HAN.test(name.name))
    .sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        LANGUAGE_RANK.get(a.language) - LANGUAGE_RANK.get(b.language) ||
        a.id - b.id,
    )[0]?.name;
  return {
    en: en ?? canonicalName,
    zh: zh ?? canonicalName,
    enFallback: !en,
    zhFallback: !zh,
  };
}

// A few GeoNames records join two variants in one value ("臺灣省 or 台灣省");
// only the first variant is a name.
const COMBINED_VARIANTS = /\s+or\s+/i;

export function simplifyExistingChineseNames(names) {
  return names.map((name) => {
    if (!LANGUAGE_RANK.has(name.language)) return name;
    const original = name.name.split(COMBINED_VARIANTS)[0].trim();
    const simplified = traditionalToSimplified(original);
    return simplified === name.name
      ? name
      : { ...name, name: simplified, originalName: original };
  });
}

function assertChineseName(names, kind, id) {
  if (!names.zhFallback && LATIN.test(names.zh))
    throw new Error(
      `GeoNames Chinese ${kind} name contains Latin letters: ${names.zh} (${id})`,
    );
}

function hasRealChineseName(names) {
  return names.some((name) => LANGUAGE_RANK.has(name.language));
}

export function candidateIncludesCity(candidate, city, realZh) {
  if (
    !city ||
    city.featureClass !== 'P' ||
    !ACTIVE_CODES.has(city.featureCode)
  ) {
    return false;
  }
  const administrative =
    city.featureCode === 'PPLC' || city.featureCode === 'PPLA';
  switch (candidate) {
    case 'A':
      return administrative || city.population >= 100_000;
    case 'B':
      return administrative || city.population >= 250_000;
    case 'C':
      return administrative || city.population >= 500_000;
    case 'D':
      return realZh || administrative || city.population >= 250_000;
    default:
      throw new Error(`Unknown feasibility candidate: ${candidate}`);
  }
}

export function selectCompactAliases(city, selectedNames, names) {
  const seen = new Set(
    [selectedNames.en, selectedNames.zh].map(normalizeForDeduplication),
  );
  const aliases = [];
  const add = (name) => {
    const normalized = normalizeForDeduplication(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    aliases.push(name);
  };
  add(city.canonicalName);
  add(city.asciiName);
  const englishCandidates = names
    .filter((name) => name.language === 'en')
    .sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        a.id - b.id ||
        a.name.localeCompare(b.name, 'und'),
    );
  let englishAdded = 0;
  for (const candidate of englishCandidates) {
    const before = aliases.length;
    add(candidate.name);
    if (aliases.length > before && ++englishAdded === 2) break;
  }
  const chineseCandidates = names
    .filter((name) => LANGUAGE_RANK.has(name.language))
    .sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        LANGUAGE_RANK.get(a.language) - LANGUAGE_RANK.get(b.language) ||
        a.id - b.id ||
        a.name.localeCompare(b.name, 'und'),
    );
  for (const candidate of chineseCandidates) {
    add(candidate.name);
    if (candidate.originalName) add(candidate.originalName);
  }
  return aliases;
}

export function buildFeasibilityIndex({
  cities,
  countries,
  admin1,
  alternateNames,
  aliasMode = 'compact',
}) {
  const records = cities
    .map((city) => {
      const country = countries.get(city.countryCode);
      const admin = city.admin1Code
        ? admin1.get(`${city.countryCode}.${city.admin1Code}`)
        : null;
      if (!country || !city.admin1Code || !admin) {
        throw new Error(
          `Feasibility index received a city without exact joins: ${city.id}`,
        );
      }
      const cityAlternates = simplifyExistingChineseNames(
        alternateNames.get(city.id) ?? [],
      );
      const cityNames = chooseLocalizedNames(
        city.canonicalName,
        cityAlternates,
      );
      const countryNames = chooseLocalizedNames(
        country.name,
        simplifyExistingChineseNames(
          alternateNames.get(country.geoNameId) ?? [],
        ),
      );
      const adminNames = admin
        ? chooseLocalizedNames(
            admin.name,
            simplifyExistingChineseNames(
              alternateNames.get(admin.geoNameId) ?? [],
            ),
          )
        : null;
      assertChineseName(cityNames, 'city', city.id);
      assertChineseName(countryNames, 'country', country.code);
      if (adminNames) assertChineseName(adminNames, 'admin-1', admin.key);
      return {
        city,
        cityNames,
        countryNames,
        adminNames,
        realZh: hasRealChineseName(cityAlternates),
        aliases: selectAliasesForMode(
          city,
          cityNames,
          cityAlternates,
          aliasMode,
        ),
      };
    })
    .sort((a, b) => a.city.id - b.city.id);
  const strings = [
    ...new Set(
      records.flatMap((record) => [
        record.city.countryCode,
        record.cityNames.en,
        record.cityNames.zh,
        record.countryNames.en,
        record.countryNames.zh,
        ...(record.adminNames
          ? [record.adminNames.en, record.adminNames.zh]
          : []),
        ...record.aliases,
      ]),
    ),
  ].sort((a, b) => a.localeCompare(b, 'und'));
  const positions = new Map(strings.map((value, index) => [value, index]));
  const at = (value) => positions.get(value);
  const rows = records.map((record) => [
    record.city.id,
    Math.round(record.city.latitude * 100_000),
    Math.round(record.city.longitude * 100_000),
    record.city.population,
    record.city.featureCode === 'PPLC'
      ? 0
      : record.city.featureCode === 'PPLA'
        ? 1
        : 2,
    at(record.city.countryCode),
    at(record.cityNames.en),
    at(record.cityNames.zh),
    at(record.countryNames.en),
    at(record.countryNames.zh),
    record.adminNames ? at(record.adminNames.en) : null,
    record.adminNames ? at(record.adminNames.zh) : null,
    record.aliases.map(at),
    Number(record.cityNames.zhFallback),
  ]);
  return {
    asset: { formatVersion: 2, strings, rows },
    rows,
    records,
    coverage: {
      cityRealZh: records.filter((record) => record.realZh).length,
      countryRealZh: records.filter((record) => !record.countryNames.zhFallback)
        .length,
      admin1Records: records.filter((record) => record.adminNames).length,
      admin1RealZh: records.filter(
        (record) => record.adminNames && !record.adminNames.zhFallback,
      ).length,
    },
  };
}

function selectAliasesForMode(city, cityNames, cityAlternates, aliasMode) {
  const aliases = selectCompactAliases(city, cityNames, cityAlternates);
  if (aliasMode === 'compact') return aliases;
  if (aliasMode === 'display-only') return [];
  if (aliasMode === 'bilingual-core') {
    const chinese = new Set(
      cityAlternates
        .filter((name) => LANGUAGE_RANK.has(name.language))
        .map((name) => normalizeForDeduplication(name.name)),
    );
    return aliases.filter((alias) =>
      chinese.has(normalizeForDeduplication(alias)),
    );
  }
  throw new Error(`Unknown feasibility alias mode: ${aliasMode}`);
}

export function buildCompactIndex({
  cities,
  countries,
  admin1,
  alternateNames,
}) {
  const seen = new Set();
  const records = [];
  const coverage = {
    cityEnFallbacks: 0,
    cityZhFallbacks: 0,
    countryEnFallbacks: 0,
    countryZhFallbacks: 0,
    admin1EnFallbacks: 0,
    admin1ZhFallbacks: 0,
  };
  for (const city of cities) {
    if (!city) continue;
    if (seen.has(city.id))
      throw new Error(`Duplicate GeoNames city ID: ${city.id}`);
    seen.add(city.id);
    const country = countries.get(city.countryCode);
    if (!country)
      throw new Error(`Missing exact country join: ${city.countryCode}`);
    const admin = city.admin1Code
      ? admin1.get(`${city.countryCode}.${city.admin1Code}`)
      : null;
    if (!city.admin1Code || !admin)
      throw new Error(
        `Missing exact admin-1 join: ${city.countryCode}.${city.admin1Code || '<empty>'}`,
      );
    const cityAlternates = simplifyExistingChineseNames(
      alternateNames.get(city.id) ?? [],
    );
    const cityNames = chooseLocalizedNames(city.canonicalName, cityAlternates);
    const countryNames = chooseLocalizedNames(
      country.name,
      simplifyExistingChineseNames(alternateNames.get(country.geoNameId) ?? []),
    );
    const adminNames = admin
      ? chooseLocalizedNames(
          admin.name,
          simplifyExistingChineseNames(
            alternateNames.get(admin.geoNameId) ?? [],
          ),
        )
      : null;
    coverage.cityEnFallbacks += Number(cityNames.enFallback);
    coverage.cityZhFallbacks += Number(cityNames.zhFallback);
    coverage.countryEnFallbacks += Number(countryNames.enFallback);
    coverage.countryZhFallbacks += Number(countryNames.zhFallback);
    coverage.admin1EnFallbacks += Number(adminNames?.enFallback ?? false);
    coverage.admin1ZhFallbacks += Number(adminNames?.zhFallback ?? false);
    const aliases = new Set([
      city.asciiName,
      ...city.sourceAliases,
      ...cityAlternates.flatMap((name) =>
        name.originalName ? [name.name, name.originalName] : [name.name],
      ),
    ]);
    aliases.delete(cityNames.en);
    aliases.delete(cityNames.zh);
    aliases.delete('');
    records.push({
      city,
      cityNames,
      countryNames,
      adminNames,
      aliases: [...aliases],
    });
  }
  records.sort((a, b) => a.city.id - b.city.id);
  const strings = [
    ...new Set(
      records.flatMap((record) => [
        record.city.countryCode,
        record.cityNames.en,
        record.cityNames.zh,
        record.countryNames.en,
        record.countryNames.zh,
        ...(record.adminNames
          ? [record.adminNames.en, record.adminNames.zh]
          : []),
        ...record.aliases,
      ]),
    ),
  ].sort((a, b) => a.localeCompare(b, 'und'));
  const stringIndex = new Map(strings.map((value, index) => [value, index]));
  const index = (value) => stringIndex.get(value);
  const rank = (code) => (code === 'PPLC' ? 0 : code === 'PPLA' ? 1 : 2);
  return {
    formatVersion: 2,
    strings,
    rows: records.map(
      ({ city, cityNames, countryNames, adminNames, aliases }) => [
        city.id,
        Math.round(city.latitude * 100_000),
        Math.round(city.longitude * 100_000),
        city.population,
        rank(city.featureCode),
        index(city.countryCode),
        index(cityNames.en),
        index(cityNames.zh),
        index(countryNames.en),
        index(countryNames.zh),
        adminNames ? index(adminNames.en) : null,
        adminNames ? index(adminNames.zh) : null,
        aliases.sort((a, b) => a.localeCompare(b, 'und')).map(index),
        Number(cityNames.zhFallback),
      ],
    ),
    coverage,
  };
}

export function createImmutableBuildInput({
  cities,
  countries,
  admin1,
  alternateNames,
}) {
  const selectedCities = cities
    .filter(
      (city) => isEligibleCity(city) && hasExactJoins(city, countries, admin1),
    )
    .map(
      ({
        id,
        canonicalName,
        asciiName,
        latitude,
        longitude,
        featureClass,
        featureCode,
        countryCode,
        admin1Code,
        population,
      }) => ({
        id,
        canonicalName,
        asciiName,
        latitude,
        longitude,
        featureClass,
        featureCode,
        countryCode,
        admin1Code,
        population,
      }),
    )
    .sort((a, b) => a.id - b.id);
  const countryCodes = new Set(selectedCities.map((city) => city.countryCode));
  const adminKeys = new Set(
    selectedCities.map((city) => `${city.countryCode}.${city.admin1Code}`),
  );
  const selectedCountries = [...countries.values()]
    .filter((country) => countryCodes.has(country.code))
    .sort((a, b) => a.code.localeCompare(b.code, 'und'));
  const selectedAdmin1 = [...admin1.values()]
    .filter((admin) => adminKeys.has(admin.key))
    .sort((a, b) => a.key.localeCompare(b.key, 'und'));
  const relevantIds = new Set([
    ...selectedCities.map((city) => city.id),
    ...selectedCountries.map((country) => country.geoNameId),
    ...selectedAdmin1.map((admin) => admin.geoNameId),
  ]);
  const selectedAlternates = [...alternateNames.entries()]
    .filter(([id]) => relevantIds.has(id))
    .map(([id, names]) => {
      const selected = names
        .filter(
          (name) => name.language === 'en' || LANGUAGE_RANK.has(name.language),
        )
        .map(({ id: alternateId, language, name, preferred }) => ({
          id: alternateId,
          language,
          name,
          preferred,
        }))
        .sort((a, b) => a.id - b.id || a.name.localeCompare(b.name, 'und'));
      return [id, selected];
    })
    .filter(([, names]) => names.length > 0)
    .sort((a, b) => a[0] - b[0]);
  return {
    schemaVersion: 2,
    cities: selectedCities,
    countries: selectedCountries,
    admin1: selectedAdmin1,
    alternateNames: selectedAlternates,
  };
}

export function buildRuntimeFromImmutableInput(input) {
  if (input?.schemaVersion !== 2) {
    throw new Error(
      `Unsupported GeoNames immutable input schema: ${String(input?.schemaVersion)}`,
    );
  }
  return buildFeasibilityIndex({
    cities: input.cities,
    countries: new Map(
      input.countries.map((country) => [country.code, country]),
    ),
    admin1: new Map(input.admin1.map((admin) => [admin.key, admin])),
    alternateNames: new Map(input.alternateNames),
  });
}

export async function readVerifiedImmutableInput(path, expectedSha256) {
  const bytes = await readFile(path);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) {
    throw new Error(
      `Immutable build input checksum mismatch: expected ${expectedSha256}, received ${actual}`,
    );
  }
  return { input: JSON.parse(bytes.toString('utf8')), bytes };
}

export async function runOfflineBuild({
  root = resolve(import.meta.dirname, '..'),
  manifestPath = resolve(root, 'src/data/manifests/geonames-major-cities.json'),
  outputPath = resolve(root, 'src/data/generated/geonames-major-cities.json'),
} = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const inputPath = resolve(root, manifest.immutableBuildInput.path);
  const { input } = await readVerifiedImmutableInput(
    inputPath,
    manifest.immutableBuildInput.sha256,
  );
  const compact = buildRuntimeFromImmutableInput(input);
  const output = `${JSON.stringify(compact.asset)}\n`;
  const bytes = Buffer.from(output);
  const report = {
    records: compact.rows.length,
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).byteLength,
    staticDecodedBytesEstimate: bytes.byteLength * 4,
    runtimeDecodedBytesEstimate: estimateRuntimeDecodedBytes(
      compact.asset,
      bytes.byteLength,
    ),
    derivedAssetSha256: createHash('sha256').update(bytes).digest('hex'),
    coverage: compact.coverage,
  };
  assertGeoNamesBudgets(report);
  const nextManifest = structuredClone(manifest);
  nextManifest.derivedAsset = {
    ...nextManifest.derivedAsset,
    formatVersion: compact.asset.formatVersion,
    sha256: report.derivedAssetSha256,
    rawBytes: report.rawBytes,
  };
  nextManifest.recordCount = report.records;
  nextManifest.rawBytes = report.rawBytes;
  nextManifest.gzipBytes = report.gzipBytes;
  nextManifest.staticDecodedBytesEstimate = report.staticDecodedBytesEstimate;
  nextManifest.runtimeDecodedBytesEstimate = report.runtimeDecodedBytesEstimate;
  await publishAssetSet([
    { path: outputPath, bytes },
    {
      path: manifestPath,
      bytes: Buffer.from(`${JSON.stringify(nextManifest, null, 2)}\n`),
    },
  ]);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function parseCapturedSources(sourceDir) {
  const countries = new Map();
  await readLines(
    createReadStream(resolve(sourceDir, 'countryInfo.txt')),
    (line) => {
      const value = parseCountryRow(line);
      if (value) countries.set(value.code, value);
    },
  );
  const admin1 = new Map();
  await readLines(
    createReadStream(resolve(sourceDir, 'admin1CodesASCII.txt')),
    (line) => {
      const value = parseAdmin1Row(line);
      if (value) admin1.set(value.key, value);
    },
  );
  const cities = [];
  await readZipLines(
    resolve(sourceDir, 'cities15000.zip'),
    'cities15000.txt',
    (line) => {
      const value = parseCityRow(line);
      if (isEligibleCity(value)) cities.push(value);
    },
  );
  const joinedCities = cities.filter((city) =>
    hasExactJoins(city, countries, admin1),
  );
  const relevantIds = new Set([
    ...joinedCities.map((city) => city.id),
    ...countries.values().map((country) => country.geoNameId),
    ...admin1.values().map((admin) => admin.geoNameId),
  ]);
  const alternateNames = new Map();
  await readZipLines(
    resolve(sourceDir, 'alternateNamesV2.zip'),
    'alternateNamesV2.txt',
    (line) => {
      const value = parseAlternateNameRow(line);
      if (!value || !relevantIds.has(value.geoNameId)) return;
      const names = alternateNames.get(value.geoNameId) ?? [];
      names.push(value);
      alternateNames.set(value.geoNameId, names);
    },
  );
  return { cities, countries, admin1, alternateNames };
}

export async function captureSourceFiles(
  sourceDir,
  fetchImplementation = fetch,
  definitions = SOURCE_DEFINITIONS,
) {
  await mkdir(sourceDir, { recursive: true });
  const staging = resolve(
    sourceDir,
    `.capture-${process.pid}-${crypto.randomUUID()}`,
  );
  await mkdir(staging);
  const sources = [];
  try {
    for (const definition of definitions) {
      const target = resolve(staging, definition.fileName);
      const response = await fetchImplementation(definition.distributionUrl);
      if (!response.ok || !response.body) {
        throw new Error(
          `${definition.fileName} capture failed: ${response.status} ${response.statusText}`,
        );
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(target, { flags: 'wx' }),
      );
      const size = (await stat(target)).size;
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null && Number(contentLength) !== size) {
        throw new Error(
          `${definition.fileName} source mismatch: Content-Length ${contentLength}, captured ${size}`,
        );
      }
      sources.push({
        sourceName: definition.sourceName,
        distributionUrl: definition.distributionUrl,
        fileName: definition.fileName,
        sha256: await sha256File(target),
        rawBytes: size,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      });
    }
    return { sourceDir: staging, sources };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function runCaptureCommand({
  root = resolve(import.meta.dirname, '..'),
  rawDir = resolve(root, 'tmp/geonames'),
  fetchImplementation = fetch,
  now = () => new Date(),
  captureImplementation = captureSourceFiles,
  verifyCapture = ensureSourceFiles,
  publishCapture: publishImplementation = publishCapture,
  promoteCapture = promoteCapturedSources,
} = {}) {
  const manifestPath = resolve(
    root,
    'src/data/manifests/geonames-major-cities.json',
  );
  const inputPath = resolve(
    root,
    'src/data/generated/geonames-major-cities-input.json',
  );
  const outputPath = resolve(
    root,
    'src/data/generated/geonames-major-cities.json',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const capture = await captureImplementation(rawDir, fetchImplementation);
  await verifyCapture(
    capture.sourceDir,
    { upstreamCapture: { sources: capture.sources } },
    async () => {
      throw new Error('captured sources must verify without another download');
    },
  );
  const retrievedAt = now().toISOString();
  await publishImplementation({
    root,
    manifestPath,
    inputPath,
    outputPath,
    manifest,
    capture,
    retrievedAt,
  });
  await promoteCapture(capture.sourceDir, rawDir);
}

async function promoteCapturedSources(sourceDir, rawDir) {
  const captured = resolve(rawDir, 'captured-current');
  await rm(captured, { recursive: true, force: true });
  await rename(sourceDir, captured);
}

async function rebuildCapturedInput() {
  const root = resolve(import.meta.dirname, '..');
  const manifestPath = resolve(
    root,
    'src/data/manifests/geonames-major-cities.json',
  );
  const inputPath = resolve(
    root,
    'src/data/generated/geonames-major-cities-input.json',
  );
  const outputPath = resolve(
    root,
    'src/data/generated/geonames-major-cities.json',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const sourceDir = resolve(
    root,
    process.argv[3] ?? 'tmp/geonames/captured-current',
  );
  await ensureSourceFiles(sourceDir, manifest, async () => {
    throw new Error('captured sources must be present and checksum-valid');
  });
  await publishCapture({
    root,
    manifestPath,
    inputPath,
    outputPath,
    manifest,
    capture: {
      sourceDir,
      sources: manifest.upstreamCapture.sources,
    },
    retrievedAt: manifest.upstreamCapture.retrievedAt,
  });
}

async function publishCapture({
  root,
  manifestPath,
  inputPath,
  outputPath,
  manifest,
  capture,
  retrievedAt,
}) {
  const parsed = await parseCapturedSources(capture.sourceDir);
  const immutable = createImmutableBuildInput(parsed);
  const inputBytes = Buffer.from(`${JSON.stringify(immutable)}\n`);
  const compact = buildRuntimeFromImmutableInput(immutable);
  const outputBytes = Buffer.from(`${JSON.stringify(compact.asset)}\n`);
  const prepared = prepareCapturePublication({
    manifest,
    capture,
    inputBytes,
    outputBytes,
    compact,
    retrievedAt,
  });
  await publishCaptureArtifacts({
    inputPath,
    outputPath,
    manifestPath,
    inputBytes,
    outputBytes,
    manifestBytes: prepared.manifestBytes,
  });
  console.log(
    JSON.stringify(
      {
        retrievedAt,
        sources: capture.sources,
        immutableBuildInput: prepared.manifest.immutableBuildInput,
        derivedAsset: prepared.manifest.derivedAsset,
        recordCount: prepared.manifest.recordCount,
      },
      null,
      2,
    ),
  );
}

export function prepareCapturePublication({
  manifest,
  capture,
  inputBytes,
  outputBytes,
  compact,
  retrievedAt,
}) {
  let runtime;
  try {
    runtime = JSON.parse(outputBytes.toString('utf8'));
  } catch {
    throw new Error('GeoNames capture requires runtime format version 2');
  }
  if (
    compact?.asset?.formatVersion !== 2 ||
    runtime?.formatVersion !== 2 ||
    runtime.formatVersion !== compact.asset.formatVersion
  ) {
    throw new Error('GeoNames capture requires runtime format version 2');
  }
  const next = structuredClone(manifest);
  next.version = `GeoNames capture ${retrievedAt}`;
  next.retrievedAt = retrievedAt.slice(0, 10);
  next.upstreamCapture = { retrievedAt, sources: capture.sources };
  const measurements = {
    records: compact.rows.length,
    rawBytes: outputBytes.byteLength,
    gzipBytes: gzipSync(outputBytes, { level: 9, mtime: 0 }).byteLength,
    staticDecodedBytesEstimate: outputBytes.byteLength * 4,
    runtimeDecodedBytesEstimate: estimateRuntimeDecodedBytes(
      compact.asset,
      outputBytes.byteLength,
    ),
  };
  assertGeoNamesBudgets(measurements);
  next.immutableBuildInput = {
    path: 'src/data/generated/geonames-major-cities-input.json',
    schemaVersion: 2,
    sha256: createHash('sha256').update(inputBytes).digest('hex'),
    rawBytes: inputBytes.byteLength,
  };
  next.derivedAsset = {
    path: 'src/data/generated/geonames-major-cities.json',
    formatVersion: 2,
    sha256: createHash('sha256').update(outputBytes).digest('hex'),
    rawBytes: outputBytes.byteLength,
  };
  delete next.distributionUrl;
  delete next.sha256;
  delete next.auxiliarySources;
  delete next.derivedAssetSha256;
  next.recordCount = measurements.records;
  next.rawBytes = measurements.rawBytes;
  next.gzipBytes = measurements.gzipBytes;
  next.staticDecodedBytesEstimate = measurements.staticDecodedBytesEstimate;
  next.runtimeDecodedBytesEstimate = measurements.runtimeDecodedBytesEstimate;
  return {
    manifest: next,
    manifestBytes: Buffer.from(`${JSON.stringify(next, null, 2)}\n`),
  };
}

export function assertGeoNamesBudgets(measurements) {
  const limits = {
    records: 10_000,
    rawBytes: 1.5 * 1024 * 1024,
    gzipBytes: 450 * 1024,
    staticDecodedBytesEstimate: 6 * 1024 * 1024,
    runtimeDecodedBytesEstimate: 8 * 1024 * 1024,
  };
  for (const [field, limit] of Object.entries(limits)) {
    if (measurements[field] > limit) {
      throw new Error(
        `GeoNames budget exceeded: ${field} ${measurements[field]} > ${limit}`,
      );
    }
  }
}

export async function publishCaptureArtifacts(
  {
    inputPath,
    outputPath,
    manifestPath,
    inputBytes,
    outputBytes,
    manifestBytes,
  },
  operations,
) {
  await publishAssetSet(
    [
      { path: inputPath, bytes: inputBytes },
      { path: outputPath, bytes: outputBytes },
      { path: manifestPath, bytes: manifestBytes },
    ],
    operations,
  );
}

async function runFeasibility() {
  const root = resolve(import.meta.dirname, '..');
  const sourceDir = resolve(root, process.argv[3] ?? 'tmp/geonames');
  const manifest = JSON.parse(
    await readFile(
      resolve(root, 'src/data/manifests/geonames-major-cities.json'),
      'utf8',
    ),
  );
  await ensureSourceFiles(sourceDir, manifest);
  const countries = new Map();
  await readLines(
    createReadStream(resolve(sourceDir, 'countryInfo.txt')),
    (line) => {
      const value = parseCountryRow(line);
      if (value) countries.set(value.code, value);
    },
  );
  const admin1 = new Map();
  await readLines(
    createReadStream(resolve(sourceDir, 'admin1CodesASCII.txt')),
    (line) => {
      const value = parseAdmin1Row(line);
      if (value) admin1.set(value.key, value);
    },
  );
  const activeCities = [];
  await readZipLines(
    resolve(sourceDir, 'cities15000.zip'),
    'cities15000.txt',
    (line) => {
      const city = parseCityRow(line);
      if (
        city?.featureClass === 'P' &&
        ACTIVE_CODES.has(city.featureCode) &&
        hasExactJoins(city, countries, admin1)
      ) {
        activeCities.push(city);
      }
    },
  );
  const relevantIds = new Set([
    ...activeCities.map((city) => city.id),
    ...countries.values().map((country) => country.geoNameId),
    ...admin1.values().map((admin) => admin.geoNameId),
  ]);
  const alternateNames = new Map();
  await readZipLines(
    resolve(sourceDir, 'alternateNamesV2.zip'),
    'alternateNamesV2.txt',
    (line) => {
      const value = parseAlternateNameRow(line);
      if (!value || !relevantIds.has(value.geoNameId)) return;
      const current = alternateNames.get(value.geoNameId) ?? [];
      current.push(value);
      alternateNames.set(value.geoNameId, current);
    },
  );
  const realZhIds = new Set(
    activeCities
      .filter((city) => hasRealChineseName(alternateNames.get(city.id) ?? []))
      .map((city) => city.id),
  );
  const candidates = {};
  for (const name of ['A', 'B', 'C', 'D']) {
    const selected = activeCities.filter((city) =>
      candidateIncludesCity(name, city, realZhIds.has(city.id)),
    );
    candidates[name] = profileFeasibilityIndex(
      name,
      buildFeasibilityIndex({
        cities: selected,
        countries,
        admin1,
        alternateNames,
      }),
    );
  }
  const coreIds = new Set(candidates.D.ids);
  const extendedCities = activeCities.filter(
    (city) =>
      candidateIncludesCity('A', city, realZhIds.has(city.id)) &&
      !coreIds.has(city.id),
  );
  const extended = profileFeasibilityIndex(
    'A-minus-D extended English',
    buildFeasibilityIndex({
      cities: extendedCities,
      countries,
      admin1,
      alternateNames,
    }),
  );
  const dCities = activeCities.filter((city) =>
    candidateIncludesCity('D', city, realZhIds.has(city.id)),
  );
  const coreDBilingualAliases = profileFeasibilityIndex(
    'D bilingual core aliases',
    buildFeasibilityIndex({
      cities: dCities,
      countries,
      admin1,
      alternateNames,
      aliasMode: 'bilingual-core',
    }),
  );
  const coreDDisplayOnly = profileFeasibilityIndex(
    'D display only',
    buildFeasibilityIndex({
      cities: dCities,
      countries,
      admin1,
      alternateNames,
      aliasMode: 'display-only',
    }),
  );
  const report = {
    snapshot: manifest.retrievedAt,
    activeCitiesWithExactJoins: activeCities.length,
    encoding:
      'lexical UTF-8 string table; ID-sorted E5 tuple rows; canonical/ASCII plus at most two current en and two current zh aliases; runtime normalization only',
    decodedEstimate:
      'conservative 4x serialized UTF-8 bytes, matching the existing feasibility estimate',
    candidates: Object.fromEntries(
      Object.entries(candidates).map(([key, value]) => [
        key,
        withoutIds(value),
      ]),
    ),
    twoTier: {
      coreD: withoutIds(candidates.D),
      coreDBilingualAliases: withoutIds(coreDBilingualAliases),
      coreDDisplayOnly: withoutIds(coreDDisplayOnly),
      extendedAWithoutD: withoutIds(extended),
      combined: {
        records: candidates.D.records + extended.records,
        gzipBytes: candidates.D.gzipBytes + extended.gzipBytes,
        brotliBytes: candidates.D.brotliBytes + extended.brotliBytes,
        eachDecodedUnder8MiB:
          candidates.D.decodedBytesEstimate <= 8 * 1024 * 1024 &&
          extended.decodedBytesEstimate <= 8 * 1024 * 1024,
        coreUnder450KiBGzip: candidates.D.gzipBytes <= 450 * 1024,
        totalUnder900KiBGzip:
          candidates.D.gzipBytes + extended.gzipBytes <= 900 * 1024,
      },
      bilingualAliasCoreCombined: {
        gzipBytes: coreDBilingualAliases.gzipBytes + extended.gzipBytes,
        coreUnder450KiBGzip: coreDBilingualAliases.gzipBytes <= 450 * 1024,
        totalUnder900KiBGzip:
          coreDBilingualAliases.gzipBytes + extended.gzipBytes <= 900 * 1024,
      },
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

function profileFeasibilityIndex(name, index) {
  const bytes = Buffer.from(JSON.stringify(index.asset));
  const stringsBytes = Buffer.byteLength(JSON.stringify(index.asset.strings));
  const aliases = index.rows.map((row) => row[12]);
  const aliasesBytes = Buffer.byteLength(JSON.stringify(aliases));
  const baseRows = index.rows.map((row) => row.slice(0, 12));
  const baseRowsBytes = Buffer.byteLength(JSON.stringify(baseRows));
  const fixtureDefinitions = [
    ['Beijing', 1816670, '北京', ['Beijing', '北京']],
    ['Shanghai', 1796236, '上海', ['Shanghai', '上海']],
    ['Tokyo', 1850147, '东京', ['Tokyo', '东京']],
    ['New York', 5128581, '纽约', ['New York', '纽约']],
    ['Sao Paulo', 3448439, '圣保罗', ['Sao Paulo']],
  ];
  const fixtures = Object.fromEntries(
    fixtureDefinitions.map(([label, id, expectedZh, queries]) => {
      const record = index.records.find(
        (candidate) => candidate.city.id === id,
      );
      const values = record
        ? [record.cityNames.en, record.cityNames.zh, ...record.aliases].map(
            normalizeForDeduplication,
          )
        : [];
      return [
        label,
        {
          present: Boolean(record),
          realZh: Boolean(record?.realZh),
          zh: record?.cityNames.zh ?? null,
          expectedZh,
          displayMatchesExpectedZh: record?.cityNames.zh === expectedZh,
          queries: Object.fromEntries(
            queries.map((query) => [
              query,
              values.some((value) =>
                value.includes(normalizeForDeduplication(query)),
              ),
            ]),
          ),
        },
      ];
    }),
  );
  const sameNameGroups = new Map();
  for (const record of index.records) {
    const key = normalizeForDeduplication(record.cityNames.en);
    const group = sameNameGroups.get(key) ?? [];
    group.push(record);
    sameNameGroups.set(key, group);
  }
  const ambiguous = [...sameNameGroups.values()].filter(
    (group) => group.length > 1,
  );
  const disambiguated = ambiguous.filter((group) =>
    group.every((record) => record.countryNames.en && record.adminNames?.en),
  );
  return {
    name,
    ids: index.records.map((record) => record.city.id),
    records: index.records.length,
    realZhRecords: index.coverage.cityRealZh,
    realZhCoveragePercent: roundPercent(
      index.coverage.cityRealZh,
      index.records.length,
    ),
    countryRealZhCoveragePercent: roundPercent(
      index.coverage.countryRealZh,
      index.records.length,
    ),
    admin1Records: index.coverage.admin1Records,
    admin1RealZhCoveragePercent: roundPercent(
      index.coverage.admin1RealZh,
      index.coverage.admin1Records,
    ),
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      },
    }).byteLength,
    decodedBytesEstimate: bytes.byteLength * 4,
    profile: {
      stringsBytes,
      baseRowsBytes,
      aliasReferenceBytes: aliasesBytes,
      structuralBytes:
        bytes.byteLength - stringsBytes - baseRowsBytes - aliasesBytes,
      uniqueStrings: index.asset.strings.length,
      aliasReferences: aliases.reduce((sum, values) => sum + values.length, 0),
    },
    fixtures,
    disambiguation: {
      recordsWithCountry: index.records.length,
      recordsWithAdmin1: index.coverage.admin1Records,
      repeatedEnglishNameGroups: ambiguous.length,
      repeatedGroupsWithCountryAndAdminForEveryRecord: disambiguated.length,
    },
    gates: {
      recordsUnder10000: index.records.length <= 10_000,
      rawUnder1_5MiB: bytes.byteLength <= 1.5 * 1024 * 1024,
      gzipUnder450KiB:
        gzipSync(bytes, { level: 9, mtime: 0 }).byteLength <= 450 * 1024,
      decodedUnder8MiB: bytes.byteLength * 4 <= 8 * 1024 * 1024,
    },
  };
}

function withoutIds(profile) {
  const { ids, ...rest } = profile;
  return rest;
}

function roundPercent(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10000) / 100 : 0;
}

function normalizeForDeduplication(value) {
  return value
    .trim()
    .toLocaleLowerCase('und')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function ensureSourceFiles(
  sourceDir,
  manifest,
  fetchImplementation = fetch,
) {
  await mkdir(sourceDir, { recursive: true });
  const sources = manifest.upstreamCapture?.sources ?? [
    { distributionUrl: manifest.distributionUrl, sha256: manifest.sha256 },
    ...(manifest.auxiliarySources ?? []),
  ];
  for (const source of sources) {
    const fileName = new URL(source.distributionUrl).pathname.split('/').at(-1);
    if (!fileName)
      throw new Error(`Invalid source URL: ${source.distributionUrl}`);
    const target = resolve(sourceDir, fileName);
    if (await exists(target)) {
      const actual = await sha256File(target);
      if (actual !== source.sha256) {
        throw new Error(
          `${fileName} cached checksum mismatch: expected ${source.sha256}, received ${actual}`,
        );
      }
      continue;
    }

    const temporary = `${target}.download-${process.pid}-${crypto.randomUUID()}`;
    try {
      const response = await fetchImplementation(source.distributionUrl);
      if (!response.ok || !response.body) {
        throw new Error(
          `${fileName} download failed: ${response.status} ${response.statusText}`,
        );
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporary, { flags: 'wx' }),
      );
      const actual = await sha256File(temporary);
      if (actual !== source.sha256) {
        throw new Error(
          `${fileName} checksum mismatch: expected ${source.sha256}, received ${actual}`,
        );
      }
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function readLines(input, visit) {
  for await (const line of createInterface({ input, crlfDelay: Infinity }))
    visit(line);
}

export async function readZipLines(
  archive,
  member,
  visit,
  spawnImplementation = spawn,
) {
  const child = spawnImplementation('unzip', ['-p', archive, member], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (!child.stdout) throw new Error('unzip stdout is unavailable');
  const close = new Promise((resolveClose, rejectClose) => {
    child.once('error', rejectClose);
    child.once('close', (code, signal) => {
      if (code === 0) resolveClose();
      else
        rejectClose(
          new Error(
            `unzip failed with ${code ?? `signal ${String(signal)}`}: ${archive} ${member}`,
          ),
        );
    });
  }).then(
    () => null,
    (error) => error,
  );
  let readError;
  try {
    await readLines(child.stdout, visit);
  } catch (error) {
    readError = error;
  }
  const closeError = await close;
  if (closeError) throw closeError;
  if (readError) throw readError;
}

export async function writeGeneratedAssetAtomically(
  target,
  bytes,
  { beforeRename } = {},
) {
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (beforeRename) await beforeRename(temporary, target);
    await rename(temporary, target);
    try {
      const directory = await open(resolve(target, '..'), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch {
      // The file is already atomically renamed and fsynced; directory fsync is
      // best effort because some filesystems do not support it.
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}

export function estimateRuntimeDecodedBytes(asset, serializedBytes) {
  const normalized = new Set();
  let aliasReferences = 0;
  for (const row of asset.rows) {
    for (const index of row.slice(6, 12)) {
      normalized.add(
        index === null ? '' : normalizeForDeduplication(asset.strings[index]),
      );
    }
    for (const index of row[12]) {
      normalized.add(normalizeForDeduplication(asset.strings[index]));
      aliasReferences += 1;
    }
  }
  let normalizedBytes = 0;
  for (const value of normalized) normalizedBytes += 24 + value.length * 2;
  const searchObjectBytes = asset.rows.length * (64 + 6 * 8 + 24);
  return (
    serializedBytes * 4 +
    normalizedBytes +
    searchObjectBytes +
    aliasReferences * 8
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === '--capture')
    await runCaptureCommand({
      rawDir: resolve(
        import.meta.dirname,
        '..',
        process.argv[3] ?? 'tmp/geonames',
      ),
    });
  else if (process.argv[2] === '--rebuild-captured')
    await rebuildCapturedInput();
  else if (process.argv[2] === '--feasibility') await runFeasibility();
  else await runOfflineBuild();
}
