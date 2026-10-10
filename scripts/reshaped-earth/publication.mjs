import {
  readFile,
  writeFile,
  open,
  mkdir,
  mkdtemp,
  rename,
  copyFile,
  stat,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { SOURCES } from './sources.mjs';
import { writeRgbPng } from './png.mjs';
import { encodeUnits, encodeValues, loadCountryNames } from './metadata.mjs';
import { inverseTextureBytesFromDescriptor } from '../../src/features/reshaped/inverseSampling.mjs';

const METRICS = ['population', 'gdp', 'co2', 'lights'];
const LEVELS = ['country', 'admin1'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exists = async (path) => Boolean(await stat(path).catch(() => null));

export async function buildIdRasters(c) {
  const width = 4096,
    height = 2048;
  const admin = new Uint8Array(width * height * 3),
    country = new Uint8Array(admin.length);
  const row = Buffer.alloc(c.width * 2);
  const input = await open(c.labelPath, 'r');
  try {
    for (let y = 0; y < height; y += 1) {
      const sy = Math.floor(((y + 0.5) * c.height) / height);
      let offset = 0;
      while (offset < row.length) {
        const { bytesRead } = await input.read(
          row,
          offset,
          row.length - offset,
          sy * row.length + offset,
        );
        if (!bytesRead) throw new Error('Truncated label row');
        offset += bytesRead;
      }
      for (let x = 0; x < width; x += 1) {
        const id = row.readUInt16LE(
          Math.floor(((x + 0.5) * c.width) / width) * 2,
        );
        const parent = c.adminToCountryIndex[id];
        const p = (y * width + x) * 3;
        admin[p + 1] = id >>> 8;
        admin[p + 2] = id & 255;
        country[p + 1] = parent >>> 8;
        country[p + 2] = parent & 255;
      }
    }
  } finally {
    await input.close();
  }
  return Object.fromEntries(
    [
      ['country', country],
      ['admin1', admin],
    ].map(([level, data]) => {
      const bytes = writeRgbPng(width, height, data);
      if (bytes.length > 900 * 1024)
        throw new Error(`ID raster exceeds budget: ${level}`);
      return [`ids-${level}.png`, bytes];
    }),
  );
}

export async function publishProductionAssets({
  cacheDir,
  classification: c,
  metrics,
  fields,
  fingerprint,
  cacheBudget,
}) {
  for (const key of METRICS)
    for (const level of LEVELS)
      if (
        !fields[`${key}-${level}`]?.passes ||
        fields[`${key}-${level}`].fingerprint !== fingerprint
      )
        throw new Error(`Unaccepted or stale field ${key}-${level}`);
  const stage = join(cacheDir, `publication-${fingerprint.slice(0, 16)}`);
  await mkdir(stage, { recursive: true });
  const countryNames = await loadCountryNames(cacheDir, c.countries);
  const unitAsset = encodeUnits(c, countryNames),
    valueAsset = encodeValues(c, metrics, fields);
  for (const [name, asset, budget] of [
    ['units.json', unitAsset, 120 * 1024],
    ['values.json', valueAsset, 150 * 1024],
  ]) {
    const bytes = Buffer.from(JSON.stringify(asset) + '\n');
    const compressed = gzipSync(bytes, { level: 9 }).length;
    if (compressed > budget)
      throw new Error(`${name} exceeds gzip budget: ${compressed}/${budget}`);
    await writeFile(join(stage, name), bytes);
  }
  for (const [name, bytes] of Object.entries(await buildIdRasters(c)))
    await writeFile(join(stage, name), bytes);
  await writeFile(
    join(stage, 'boundary-adjustments.json'),
    JSON.stringify(c.boundaryAdjustments) + '\n',
  );
  const derivedAssets = {};
  const describe = async (name, descriptor) => {
    const bytes = await readFile(join(stage, name));
    derivedAssets[name] = {
      path: `src/data/generated/reshaped-earth/${name}`,
      sha256: sha(bytes),
      rawBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      ...descriptor,
    };
  };
  await describe('units.json', {
    kind: 'metadata',
    content: 'units',
    gpuBytes: 0,
  });
  await describe('values.json', {
    kind: 'metadata',
    content: 'values',
    gpuBytes: 0,
  });
  await describe('boundary-adjustments.json', {
    kind: 'metadata',
    content: 'boundary-adjustments',
    gpuBytes: 0,
  });
  for (const level of LEVELS)
    await describe(`ids-${level}.png`, {
      kind: 'id-raster',
      level,
      width: 4096,
      height: 2048,
      encoding: 'rgb24',
      gpuBytes: 4096 * 2048 * 2,
    });
  for (const key of METRICS)
    for (const level of LEVELS) {
      const name = `inverse-${key}-${level}.bin`,
        h = fields[`${key}-${level}`].header;
      const bytes = await readFile(join(cacheDir, name));
      if (sha(bytes) !== fields[`${key}-${level}`].inverseSha256)
        throw new Error(`Inverse cache hash mismatch: ${name}`);
      if (bytes.length > (level === 'country' ? 4 : 8) * 1024 ** 2)
        throw new Error(`Inverse budget exceeded: ${name}`);
      await writeFile(join(stage, name), bytes);
      const descriptor = {
        kind: 'inverse-field',
        metric: key,
        level,
        width: h.width,
        height: h.height,
        encoding: h.encoding,
        stepLongitude: h.stepLongitude,
        ...(h.verticalCoordinate === 'latitude'
          ? {
              verticalCoordinate: h.verticalCoordinate,
              stepLatitude: h.stepLatitude,
            }
          : { stepS: h.stepS }),
        treeNodes: h.treeNodes,
        leafCount: h.leafCount,
        maxDepth: h.maxDepth,
      };
      await describe(name, {
        ...descriptor,
        gpuBytes: inverseTextureBytesFromDescriptor(descriptor),
      });
    }
  const inverseBytes = Object.values(derivedAssets)
    .filter((a) => a.kind === 'inverse-field')
    .map((a) => a.gpuBytes)
    .sort((a, b) => b - a);
  const paletteBytes =
    256 *
    Math.ceil((Math.max(c.units.length, c.countries.length) + 1) / 256) *
    16;
  if (
    inverseBytes[0] + inverseBytes[1] + 4096 * 2048 * 2 + paletteBytes >
    40 * 1024 ** 2
  )
    throw new Error('Dual-field morph exceeds 40 MiB GPU budget');
  const sourceNames = {
    population: 'GHS-POP R2023A',
    gdp: 'Kummu et al. downscaled GDP v4',
    co2: 'GCP-GridFED v2025.1',
    lights: 'Harmonized DMSP–VIIRS NTL v10',
    admin1: 'Natural Earth admin-1 5.1.2',
    chn: 'Mundus country boundary China view',
    default: 'Mundus country boundary default view',
  };
  const sourceAssets = {};
  for (const [key, s] of Object.entries(SOURCES))
    sourceAssets[key] = {
      key,
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
  const manifest = {
    id: 'reshaped-earth',
    formatVersion: 1,
    sourceName: 'Reshaped Earth 2020 snapshots',
    sourceUrl: 'https://github.com/0mn1si2i5/mundus',
    licenseName: 'CC BY 4.0 and Public Domain',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    version: '2026-10-10',
    retrievedAt: '2026-10-10',
    attribution:
      'European Commission JRC GHS-POP; Kummu et al.; Jones et al. GCP-GridFED; Li, Zhou, Zhao & Zhao; Natural Earth',
    redistribution: 'allowed',
    transformations: [
      '30-arcsecond unit classification and area-weighted aggregation',
      'GSM2018 flow with conservative residual transport and topology-preserving vertex-star repair',
      'adaptive quantized inverse sampling',
      'lossless columnar metric values; display area ratios quantized to at most 0.034% relative error',
    ],
    missingValuePolicy:
      'Missing is null; true zero uses 0.01 mean density; ocean, Antarctica and missing receive mean density.',
    boundaryPolicy:
      'Existing Mundus full-detail country policy; Natural Earth admin-1 reassignment recorded below.',
    coverageNote:
      '2020 global snapshots; admin-1 values sum to country values; unreconciled cells remain explicitly unassigned.',
    year: 2020,
    grid: { projection: 'cylindrical-equal-area', width: 2048, height: 1024 },
    sources: Object.entries(SOURCES).map(([key, s]) => ({
      id: s.id,
      name: sourceNames[key],
      url: s.landingUrl,
      license: s.licence,
      ...(s.year ? { year: s.year } : {}),
    })),
    sourceAssets,
    derivedAssets,
    acceptance: Object.fromEntries(
      Object.entries(fields).map(([key, f]) => [key, f.acceptance]),
    ),
    boundaryAdjustments: c.boundaryAdjustments,
    nameCoverage: c.nameCoverage,
    unassigned: Object.fromEntries(
      METRICS.map((k) => [k, metrics[k].diagnostics.unassignedFraction]),
    ),
    aggregation: Object.fromEntries(
      METRICS.map((k) => [
        k,
        { diagnostics: metrics[k].diagnostics, metadata: metrics[k].metadata },
      ]),
    ),
  };
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
  // Prepare the complete candidate outside generated/. Publish the manifest
  // last, and retain the old assets in the external cache for recovery.
  const target = resolve('src/data/generated/reshaped-earth');
  const prepared = await mkdtemp(resolve('tmp/reshaped-earth-publication-'));
  for (const name of Object.keys(derivedAssets))
    await copyFile(join(stage, name), join(prepared, name));
  const backup = join(cacheDir, `previous-generated-${Date.now()}`);
  const manifestPath = resolve('src/data/manifests/reshaped-earth.json');
  const manifestBackup = `${backup}-manifest.json`;
  if (await exists(manifestPath)) await copyFile(manifestPath, manifestBackup);
  await writeFile(
    `${manifestPath}.building`,
    JSON.stringify(manifest, null, 2) + '\n',
  );
  if (await exists(target)) await rename(target, backup);
  try {
    await rename(prepared, target);
    await rename(`${manifestPath}.building`, manifestPath);
  } catch (error) {
    if (await exists(target))
      await rename(target, `${backup}-failed-candidate`);
    if (await exists(backup)) await rename(backup, target);
    if (await exists(manifestBackup))
      await copyFile(manifestBackup, manifestPath);
    throw error;
  }
  console.log(
    JSON.stringify({
      published: target,
      previousGeneratedRetained: backup,
      cacheAllocatedBytes: cacheBudget(),
    }),
  );
  return manifest;
}
