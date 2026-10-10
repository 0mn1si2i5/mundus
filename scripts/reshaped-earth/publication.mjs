import {
  readFile,
  writeFile,
  mkdtemp,
  rename,
  copyFile,
  cp,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';
import { SOURCES } from './sources.mjs';
import { writeRgbPng } from './png.mjs';
import { encodeUnits, encodeValues, loadCountryNames } from './metadata.mjs';
import { inverseTextureBytesFromDescriptor } from '../../src/features/reshaped/inverseSampling.mjs';
import { reshapedEarthManifestSchema } from '../../src/data/manifestSchemas.ts';
import { loadCountryRaster } from './padding.mjs';

const METRICS = ['population', 'gdp', 'co2', 'lights'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gzipBytes = (bytes) => gzipSync(bytes, { level: 6 }).length;
const exists = async (path) => Boolean(await stat(path).catch(() => null));
const publishedFieldMetrics = (fields) =>
  METRICS.filter(
    (key) => fields[key]?.passes && fields[key].published !== false,
  );
const paddingCountry = (country) =>
  Object.fromEntries(
    [
      'id',
      'paletteIndex',
      'actualArea',
      'targetArea',
      'coreArea',
      'paddingArea',
      'paddingFraction',
      'onePixelRelativeError',
      'rasterActualArea',
    ].map((key) => [key, country[key]]),
  );

/** Retain the proven coastal label ties, then publish only country IDs. */
export async function buildIdRasters(c, masks = {}) {
  const { width, height, ids } = await loadCountryRaster(c);
  if (c.countries.length > 255) throw new Error('Country IDs exceed R8');
  const country = new Uint8Array(width * height * 3);
  for (const [metric, mask] of Object.entries(masks)) {
    if (!METRICS.includes(metric) || mask.length !== ids.length)
      throw new Error(`Invalid padding raster ${metric}`);
  }
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (!Number.isInteger(id) || id < 0 || id > c.countries.length)
      throw new Error(`Unknown country raster ID ${id}`);
    country[i * 3] = id;
    for (const [metric, mask] of Object.entries(masks)) {
      if (mask[i] !== 0 && mask[i] !== 1)
        throw new Error(`Invalid padding byte ${metric}:${i}`);
      if (!id && mask[i]) throw new Error('Ocean cannot contain padding');
      country[i * 3 + 1] |= mask[i] << METRICS.indexOf(metric);
    }
  }
  const bytes = writeRgbPng(width, height, country);
  if (bytes.length > 900_000)
    throw new Error(`ID raster exceeds budget: ${bytes.length}/900000`);
  return { 'ids-country.png': bytes };
}

export function assertProductionFields(
  fields,
  fingerprint,
  publishedMetrics = publishedFieldMetrics(fields),
) {
  const expected = METRICS.filter(
    (key) => key !== 'gdp' || publishedMetrics.includes('gdp'),
  );
  if (
    JSON.stringify(publishedMetrics) !== JSON.stringify(expected) ||
    Object.keys(fields).some((key) => !METRICS.includes(key))
  )
    throw new Error(
      'Production requires population, CO2 and lights with optional GDP',
    );
  for (const key of publishedMetrics) {
    const field = fields[key];
    if (!field?.passes || field.fingerprint !== fingerprint)
      throw new Error(`Unaccepted or stale field ${key}`);
    if (
      field.determinism?.builds !== 2 ||
      field.determinism.byteIdentical !== true ||
      field.determinism.inverseSha256 !== field.inverseSha256 ||
      field.determinism.paddingSha256 !== field.paddingSha256
    )
      throw new Error(`Unverified deterministic rebuild ${key}`);
  }
}

/**
 * Replace the already verified candidate while keeping every rename on the
 * filesystem that owns its destination. The cache copy is retained for
 * recovery and inspection, but is never part of the atomic swap.
 */
export async function publishVerifiedAssets({
  target,
  prepared,
  manifestPath,
  manifestBuilding,
  cacheDir,
  timestamp = Date.now(),
  operations = {},
}) {
  const move = operations.rename ?? rename;
  const copyDirectory = operations.cp ?? cp;
  const copy = operations.copyFile ?? copyFile;
  const remove = operations.rm ?? rm;
  const has = operations.exists ?? exists;
  const publicationParent = dirname(target);
  const retainedBackup = join(cacheDir, `previous-generated-${timestamp}`);
  const manifestBackup = `${retainedBackup}-manifest.json`;
  const localBackup = join(
    publicationParent,
    `.reshaped-earth-previous-${timestamp}`,
  );
  const failedCandidate = join(
    publicationParent,
    `.reshaped-earth-failed-${timestamp}`,
  );
  const hadTarget = await has(target);
  const hadManifest = await has(manifestPath);

  // A retained cache copy may cross filesystems; it is deliberately made
  // before mutating the live directory. The local backup below is the one
  // used for the atomic rollback.
  if (hadTarget)
    await copyDirectory(target, retainedBackup, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  if (hadManifest) await copy(manifestPath, manifestBackup);

  let movedPrevious = false;
  let candidatePublished = false;
  try {
    if (hadTarget) {
      await move(target, localBackup);
      movedPrevious = true;
    }
    await move(prepared, target);
    candidatePublished = true;
    await move(manifestBuilding, manifestPath);
  } catch (error) {
    let recoveryError;
    try {
      // If the failure happened before the first rename, leave the live
      // directory untouched. Otherwise move the candidate aside before
      // restoring the same-filesystem backup.
      if (candidatePublished && (await has(target)))
        await move(target, failedCandidate);
      if (movedPrevious) await move(localBackup, target);
      else if (candidatePublished)
        await remove(target, { recursive: true, force: true });
      if (hadManifest) await copy(manifestBackup, manifestPath);
      else await remove(manifestPath, { force: true });
      await remove(manifestBuilding, { force: true });
      await remove(prepared, { recursive: true, force: true });
    } catch (rollbackError) {
      recoveryError = rollbackError;
    }
    if (recoveryError) {
      error.recoveryRequired = true;
      error.recoveryError = recoveryError;
      throw error;
    }
    await remove(failedCandidate, { recursive: true, force: true });
    await remove(localBackup, { recursive: true, force: true });
    throw error;
  }
  await remove(localBackup, { recursive: true, force: true });
  return { retainedBackup, manifestBackup };
}

export async function publishProductionAssets({
  cacheDir,
  fieldDir,
  classification: c,
  metrics,
  fields,
  fingerprint,
  cacheBudget,
  publishedMetrics = publishedFieldMetrics(fields),
}) {
  assertProductionFields(fields, fingerprint, publishedMetrics);
  const stage = await mkdtemp(
    join(cacheDir, `publication-${fingerprint.slice(0, 16)}-`),
  );
  const countryNames = await loadCountryNames(cacheDir, c.countries);
  const unitAsset = encodeUnits(c, countryNames),
    valueAsset = encodeValues(
      c,
      metrics,
      fields,
      countryNames,
      publishedMetrics,
    );
  const derivedAssets = {};
  const describe = async (name, bytes, descriptor) => {
    await writeFile(join(stage, name), bytes);
    derivedAssets[name] = {
      path: `src/data/generated/reshaped-earth/${name}`,
      sha256: sha(bytes),
      rawBytes: bytes.length,
      gzipBytes: gzipBytes(bytes),
      ...descriptor,
    };
  };
  for (const [name, asset] of [
    ['units.json', unitAsset],
    ['values.json', valueAsset],
  ])
    await describe(name, Buffer.from(JSON.stringify(asset) + '\n'), {
      kind: 'metadata',
      content: name.replace('.json', ''),
      gpuBytes: 0,
    });
  const masks = {};
  for (const key of publishedMetrics) {
    masks[key] = await readFile(join(fieldDir, `padding-${key}.u8`));
    if (sha(masks[key]) !== fields[key].paddingSha256)
      throw new Error(`Padding cache identity mismatch: ${key}`);
  }
  for (const [name, bytes] of Object.entries(await buildIdRasters(c, masks)))
    await describe(name, bytes, {
      kind: 'id-raster',
      width: 4096,
      height: 2048,
      encoding: 'country-padding-rg8',
      gpuBytes: 4096 * 2048 * 2,
    });
  for (const key of publishedMetrics) {
    const name = `inverse-${key}.bin`,
      field = fields[key],
      h = field.header;
    const bytes = await readFile(join(fieldDir, name));
    if (
      sha(bytes) !== field.inverseSha256 ||
      bytes.length !== field.encodedBytes ||
      gzipBytes(bytes) !== field.gzipBytes
    )
      throw new Error(
        `Inverse cache identity or gzip-6 size mismatch: ${name}`,
      );
    const descriptor = {
      kind: 'inverse-field',
      metric: key,
      width: h.width,
      height: h.height,
      encoding: h.encoding,
      stepLongitude: h.stepLongitude,
      stepS: h.stepS,
    };
    await describe(name, bytes, {
      ...descriptor,
      gpuBytes: inverseTextureBytesFromDescriptor(descriptor),
    });
  }
  const sourceNames = {
    population: 'GHS-POP R2023A',
    gdp: 'Kummu et al. downscaled GDP v4',
    co2: 'GCP-GridFED v2025.1',
    lights: 'Harmonized DMSP–VIIRS NTL v10',
    admin1: 'Natural Earth admin-1 5.1.2 (classification input)',
    chn: 'Mundus country boundary China view',
    default: 'Mundus country boundary default view',
  };
  const sourceAssets = {};
  for (const [key, s] of Object.entries(SOURCES))
    sourceAssets[key] = {
      key,
      published: key !== 'gdp' || publishedMetrics.includes('gdp'),
      fileName: s.fileName,
      distributionUrl: s.url,
      sha256: s.sha256,
      rawBytes: s.bytes ?? (await stat(join(cacheDir, s.fileName))).size,
      licenseName: s.licence,
      licenseUrl: s.licenceUrl,
      version: s.version,
      retrievedAt: s.retrievedAt,
      selection: s.selection,
      ...(s.year ? { year: s.year } : {}),
    };
  const manifest = reshapedEarthManifestSchema.parse({
    id: 'reshaped-earth',
    formatVersion: 4,
    publishedMetrics,
    unpublishedMetrics: publishedMetrics.includes('gdp') ? [] : ['gdp'],
    metricBits: { population: 0, gdp: 1, co2: 2, lights: 3 },
    sourceName: 'Reshaped Earth 2020 country snapshots',
    sourceUrl: 'https://github.com/0mn1si2i5/mundus',
    licenseName: 'CC BY 4.0 and Public Domain',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    version: '2026-10-10',
    retrievedAt: '2026-10-10',
    attribution: `European Commission JRC GHS-POP; ${publishedMetrics.includes('gdp') ? 'Kummu et al.; ' : ''}Jones et al. GCP-GridFED; Li, Zhou, Zhao & Zhao; Natural Earth`,
    redistribution: 'allowed',
    transformations: [
      '30-arcsecond classification with the existing Mundus country ownership and coastal fallback',
      'Area-weighted country aggregation of the published 2020 source snapshots',
      'Offline JS GSM2018 flow with bounded residual-density corrections',
      'MRE3 uniform 1024×512 periodic node inverse; Int16 delta longitude and sine latitude, meshopt vertex encoding',
      'Lossless country JSON metadata; budgets measured with gzip level 6',
      'Spherical 8-neighbour chamfer selects the intended solid core; country ID in R, stable metric padding bits in G, reserved B=0',
    ],
    missingValuePolicy:
      'Missing is null; true zero uses 0.01 mean density; ocean, Antarctica and missing receive mean density.',
    boundaryPolicy:
      'Existing Mundus full-detail country policy; the retained admin-1 classification preserves coastal label ties but only country records are published.',
    coverageNote:
      '239 named countries; 2020 global snapshots; unreconciled source cells remain explicitly unassigned.',
    year: 2020,
    grid: { projection: 'cylindrical-equal-area', width: 2048, height: 1024 },
    sources: Object.entries(SOURCES)
      .filter(([key]) => key !== 'gdp' || publishedMetrics.includes('gdp'))
      .map(([key, s]) => ({
        id: s.id,
        name: sourceNames[key],
        url: s.landingUrl,
        license: s.licence,
        ...(s.year ? { year: s.year } : {}),
      })),
    sourceAssets,
    derivedAssets,
    acceptance: Object.fromEntries(
      publishedMetrics.map((key) => [key, fields[key].acceptance]),
    ),
    parameters: Object.fromEntries(
      publishedMetrics.map((key) => [key, fields[key].parameters]),
    ),
    determinism: Object.fromEntries(
      publishedMetrics.map((key) => [key, fields[key].determinism]),
    ),
    padding: Object.fromEntries(
      publishedMetrics.map((key) => [
        key,
        {
          countries: fields[key].padding.countries.map(paddingCountry),
          skippedCountries: fields[key].padding.skippedCountries.map(
            ({ id, paletteIndex, pixelCount }) => ({
              id,
              paletteIndex,
              pixelCount,
            }),
          ),
          maxFraction: fields[key].padding.maxFraction,
          algorithm: 'spherical-chamfer-8',
          triggerRatio: 1.1,
          minimumPixels: 64,
        },
      ]),
    ),
    nameCoverage: {
      countries: unitAsset.units.length,
      chinese: unitAsset.units.filter((u) => u.name.zh).length,
      fraction: 1,
    },
    unassigned: Object.fromEntries(
      METRICS.map((key) => [key, metrics[key].diagnostics.unassignedFraction]),
    ),
    aggregation: Object.fromEntries(
      METRICS.map((key) => [
        key,
        {
          published: publishedMetrics.includes(key),
          diagnostics: metrics[key].diagnostics,
          metadata: metrics[key].metadata,
        },
      ]),
    ),
  });
  await writeFile(
    join(stage, 'manifest.json'),
    JSON.stringify(manifest) + '\n',
  );
  cacheBudget();
  execFileSync(
    process.execPath,
    [
      resolve('scripts/verify-generated-data.mjs'),
      '--reshaped-manifest',
      join(stage, 'manifest.json'),
      '--reshaped-assets',
      stage,
    ],
    { stdio: 'inherit' },
  );

  // Replace only the fully verified candidate. Retain the previous directory
  // and manifest outside the worktree, including on a publication failure.
  const target = resolve('src/data/generated/reshaped-earth');
  const prepared = await mkdtemp(
    join(dirname(target), '.reshaped-earth-publication-'),
  );
  for (const name of Object.keys(derivedAssets))
    await copyFile(join(stage, name), join(prepared, name));
  const manifestPath = resolve('src/data/manifests/reshaped-earth.json');
  await writeFile(
    `${manifestPath}.building`,
    await format(JSON.stringify(manifest), {
      ...(await resolveConfig(manifestPath)),
      filepath: manifestPath,
    }),
  );
  const { retainedBackup } = await publishVerifiedAssets({
    target,
    prepared,
    manifestPath,
    manifestBuilding: `${manifestPath}.building`,
    cacheDir,
  });
  console.log(
    JSON.stringify({
      published: target,
      previousGeneratedRetained: retainedBackup,
      cacheAllocatedBytes: cacheBudget(),
    }),
  );
  return manifest;
}
