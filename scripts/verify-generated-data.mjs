import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { reshapedEarthManifestSchema } from '../src/data/manifestSchemas.ts';
import assert from 'node:assert/strict';
import { SOURCES } from './reshaped-earth/sources.mjs';
import { decodePngRgb } from '../src/features/reshaped/pngCore.mjs';
import { decodeInverse } from '../src/features/reshaped/inverseFormat.mjs';
import { inverseTextureBytes } from '../src/features/reshaped/inverseSampling.mjs';
import {
  decodeUnits,
  decodeValues,
} from '../src/features/reshaped/metadata.mjs';

const reshapedMetrics = ['population', 'gdp', 'co2', 'lights'];

const option = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  assert.ok(
    process.argv[index + 1] && !process.argv[index + 1].startsWith('--'),
    `Missing ${name} value`,
  );
  return resolve(process.argv[index + 1]);
};
const candidateManifestPath = option('--reshaped-manifest');
const candidateAssetDirectory = option('--reshaped-assets');
assert.equal(
  Boolean(candidateManifestPath),
  Boolean(candidateAssetDirectory),
  'Candidate manifest and asset directory must be specified together',
);
const reshapedManifestPath =
  candidateManifestPath ?? 'src/data/manifests/reshaped-earth.json';
const reshapedPath = (name, manifest) =>
  candidateAssetDirectory
    ? join(candidateAssetDirectory, name)
    : manifest.derivedAssets[name].path;

const assets = [
  {
    manifest: 'src/data/manifests/mundus-countries.json',
    asset: 'src/data/generated/mundus-countries-110m.json',
    hashField: 'topologyAssets.110m.sha256',
  },
  {
    manifest: 'src/data/manifests/mundus-countries.json',
    asset: 'src/data/generated/mundus-countries-50m.json',
    hashField: 'topologyAssets.50m.sha256',
  },
  {
    manifest: 'src/data/manifests/natural-earth-vector-globe.json',
    asset: 'src/data/generated/mundus-countries-50m.json',
    hashField: 'sourceAssets.50m.sha256',
  },
  {
    manifest: 'src/data/manifests/natural-earth-vector-globe.json',
    asset: 'src/data/generated/natural-earth-vector-globe-110m.mvg',
    hashField: 'derivedAssets.110m.sha256',
  },
  {
    manifest: 'src/data/manifests/natural-earth-vector-globe.json',
    asset: 'src/data/generated/natural-earth-vector-globe-50m.mvg',
    hashField: 'derivedAssets.50m.sha256',
  },
  {
    manifest: 'src/data/manifests/geonames-major-cities.json',
    asset: 'src/data/generated/geonames-major-cities-input.json',
    hashField: 'immutableBuildInput.sha256',
  },
  {
    manifest: 'src/data/manifests/geonames-major-cities.json',
    asset: 'src/data/generated/geonames-major-cities.json',
    hashField: 'derivedAsset.sha256',
    budgets: true,
  },
  {
    manifest: 'src/data/manifests/surnames-by-country.json',
    asset: 'src/data/generated/surnames-by-country.json',
    hashField: 'derivedAssetSha256',
    budgets: true,
  },
  {
    manifest: 'src/data/manifests/country-label-anchors.json',
    asset: 'src/data/generated/country-label-anchors.json',
    hashField: 'derivedAssetSha256',
  },
  {
    manifest: 'src/data/manifests/surname-label-slots.json',
    asset: 'src/data/generated/surname-label-slots.json',
    hashField: 'derivedAssetSha256',
  },
  {
    manifest: 'src/data/manifests/surname-coverage.json',
    asset: 'src/data/generated/surname-coverage.json',
    hashField: 'derivedAssetSha256',
  },
  {
    manifest: 'src/data/manifests/urban-isolation.json',
    asset: 'src/data/generated/urban-isolation-input.json',
    hashField: 'immutableBuildInput.sha256',
  },
  {
    manifest: 'src/data/manifests/urban-isolation.json',
    asset: 'src/data/generated/urban-isolation.json',
    hashField: 'derivedAsset.sha256',
  },
];

const reshapedManifest = JSON.parse(
  await readFile(reshapedManifestPath, 'utf8'),
);
const reshapedAssetNames = [
  'units.json',
  'values.json',
  'ids-country.png',
  ...(reshapedManifest.publishedMetrics ?? reshapedMetrics).map(
    (metric) => `inverse-${metric}.bin`,
  ),
];
assert.deepEqual(
  Object.keys(reshapedManifest.derivedAssets ?? {}).sort(),
  [...reshapedAssetNames].sort(),
  'Reshaped Earth must register its complete asset set',
);
if (candidateManifestPath) assets.length = 0;
for (const name of reshapedAssetNames) {
  const asset = reshapedManifest.derivedAssets[name];
  assert.equal(asset.path, `src/data/generated/reshaped-earth/${name}`);
  assets.push({
    manifest: reshapedManifestPath,
    asset: reshapedPath(name, reshapedManifest),
    expectedHash: asset.sha256,
    expectedRawBytes: asset.rawBytes,
    expectedGzipBytes: asset.gzipBytes,
    gzipLevel: 6,
  });
}

let failed = false;
for (const entry of assets) {
  const [manifestBytes, assetBytes] = await Promise.all([
    readFile(entry.manifest),
    readFile(entry.asset),
  ]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const expected =
    entry.expectedHash ??
    entry.hashField
      .split('.')
      .reduce((value, field) => value?.[field], manifest);
  const actual = createHash('sha256').update(assetBytes).digest('hex');
  if (typeof expected !== 'string' || actual !== expected) {
    failed = true;
    console.error(
      `${entry.asset}: expected ${String(expected)}, received ${actual}`,
    );
  } else {
    console.log(`${entry.asset}: verified ${actual}`);
  }
  if (
    entry.expectedRawBytes !== undefined &&
    assetBytes.byteLength !== entry.expectedRawBytes
  ) {
    failed = true;
    console.error(
      `${entry.asset}: expected ${entry.expectedRawBytes} bytes, received ${assetBytes.byteLength}`,
    );
  }
  if (entry.expectedGzipBytes !== undefined) {
    const actualGzipBytes = gzipSync(assetBytes, {
      level: entry.gzipLevel ?? 9,
      mtime: 0,
    }).byteLength;
    if (actualGzipBytes !== entry.expectedGzipBytes) {
      failed = true;
      console.error(
        `${entry.asset}: expected ${entry.expectedGzipBytes} gzip bytes, received ${actualGzipBytes}`,
      );
    }
  }
  if (entry.budgets) {
    const parsed = JSON.parse(assetBytes.toString('utf8'));
    const measurements = {
      recordCount:
        parsed.rows?.length ??
        Object.values(parsed.countries ?? {}).reduce(
          (count, country) => count + (country.records?.length ?? 0),
          0,
        ),
      rawBytes: assetBytes.byteLength,
      gzipBytes: gzipSync(assetBytes, { level: 9, mtime: 0 }).byteLength,
      staticDecodedBytesEstimate: assetBytes.byteLength * 4,
      runtimeDecodedBytesEstimate: parsed.rows
        ? estimateRuntimeDecodedBytes(parsed, assetBytes.byteLength)
        : assetBytes.byteLength * 6,
    };
    for (const [field, actualValue] of Object.entries(measurements)) {
      if (actualValue !== manifest[field]) {
        failed = true;
        console.error(
          `${entry.asset}: ${field} expected ${manifest[field]}, received ${actualValue}`,
        );
      }
    }
    if (
      manifest.id === 'surnames-by-country'
        ? measurements.recordCount > 400 ||
          measurements.rawBytes > 200 * 1024 ||
          measurements.gzipBytes > 80 * 1024 ||
          measurements.staticDecodedBytesEstimate > 800 * 1024 ||
          manifest.runtimeDecodedBytesEstimate > 2 * 1024 * 1024
        : measurements.recordCount > 10_000 ||
          measurements.rawBytes > 1.5 * 1024 * 1024 ||
          measurements.gzipBytes > 450 * 1024 ||
          measurements.staticDecodedBytesEstimate > 6 * 1024 * 1024 ||
          manifest.runtimeDecodedBytesEstimate > 8 * 1024 * 1024
    ) {
      failed = true;
      console.error(`${entry.asset}: GeoNames budget exceeded`);
    }
  }
}

try {
  reshapedEarthManifestSchema.parse(reshapedManifest);
  await verifyReshapedData(reshapedManifest);
  console.log(
    'Reshaped Earth: formats, provenance, conservation and budgets verified',
  );
} catch (error) {
  failed = true;
  console.error(`Reshaped Earth: ${error.message}`);
}

if (failed) process.exitCode = 1;

async function verifyReshapedData(manifest) {
  assert.equal(manifest.formatVersion, 4, 'Manifest format version must be 4');
  assert.deepEqual(
    Object.keys(manifest.sourceAssets).sort(),
    Object.keys(SOURCES).sort(),
  );
  for (const [key, source] of Object.entries(SOURCES)) {
    const captured = manifest.sourceAssets[key];
    for (const [field, expected] of Object.entries({
      key,
      fileName: source.fileName,
      distributionUrl: source.url,
      sha256: source.sha256,
      licenseName: source.licence,
      licenseUrl: source.licenceUrl,
      version: source.version,
      retrievedAt: source.retrievedAt,
      selection: source.selection,
    }))
      assert.equal(
        captured[field],
        expected,
        `Source ${key}: ${field} changed`,
      );
    if (source.bytes !== undefined)
      assert.equal(captured.rawBytes, source.bytes);
    if (source.year !== undefined) assert.equal(captured.year, 2020);
  }
  const loadJson = async (name) =>
    JSON.parse(await readFile(reshapedPath(name, manifest), 'utf8'));
  const [encodedUnits, encodedValues, countries] = await Promise.all([
    loadJson('units.json'),
    loadJson('values.json'),
    readFile('src/data/generated/mundus-countries-50m.json', 'utf8').then(
      JSON.parse,
    ),
  ]);
  const units = decodeUnits(encodedUnits),
    rows = decodeValues(encodedValues, units);
  assert.deepEqual(encodedValues.metrics, manifest.publishedMetrics);
  const countryIds = countries.objects.countries.geometries.map(
    (geometry) => geometry.properties.countryId,
  );
  assert.deepEqual(
    units.map((unit) => unit.id).sort(),
    countryIds.sort(),
    'Country coverage must match Mundus',
  );
  assert.equal(units.length, 239);
  assert.deepEqual(manifest.nameCoverage, {
    countries: 239,
    chinese: 239,
    fraction: 1,
  });
  const rasterIds = new Set();
  for (const unit of units) {
    assert.notEqual(
      unit.name.zh,
      unit.name.en,
      `Country ${unit.id}: Chinese name must use the reviewed localization`,
    );
    assert.equal(
      unit.excluded,
      unit.id === 'ne-010',
      'Only Antarctica is excluded',
    );
    assert.ok(unit.rasterId <= 65535, 'GPU country IDs fit lossless RG8');
    rasterIds.add(unit.rasterId);
  }
  const relative = (actual, expected) =>
    Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
  for (const metric of manifest.publishedMetrics) {
    assert.equal(encodedValues.sourceIds[metric], SOURCES[metric].id);
    const diagnostics = manifest.aggregation[metric].diagnostics;
    const assigned = rows.reduce(
      (sum, row) => sum + (row.values[metric] ?? 0),
      0,
    );
    assert.ok(
      relative(assigned, diagnostics.assignedTotal) < 1e-9,
      `${metric}: assigned country total differs`,
    );
    assert.ok(
      relative(assigned + diagnostics.unassigned, diagnostics.validTotal) <
        1e-9,
      `${metric}: source conservation failed`,
    );
    assert.ok(
      relative(encodedValues.totals[metric], diagnostics.assignedTotal) < 1e-12,
    );
    assert.equal(manifest.unassigned[metric], diagnostics.unassignedFraction);
    assert.ok(
      relative(
        diagnostics.unassignedFraction,
        diagnostics.unassigned / diagnostics.validTotal,
      ) < 1e-12,
    );
    if (metric === 'population')
      assert.ok(
        Math.abs(diagnostics.validTotal / 7.8e9 - 1) <= 0.02,
        'Population total differs from 2020 scale',
      );
    if (metric === 'co2')
      assert.ok(
        Math.abs(diagnostics.validTotal / 34.3e9 - 1) <= 0.05,
        'CO2 total differs from 2020 scale',
      );
  }
  const rasterAsset = manifest.derivedAssets['ids-country.png'];
  const bytes = await readFile(reshapedPath('ids-country.png', manifest));
  const raster = await decodePngRgb(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  assert.equal(raster.width, rasterAsset.width);
  assert.equal(raster.height, rasterAsset.height);
  assert.ok(
    raster.ids.some((id) => id !== 0),
    'Country raster must contain land',
  );
  const allowedBits = manifest.publishedMetrics.reduce(
    (bits, metric) => bits | (1 << manifest.metricBits[metric]),
    0,
  );
  for (const pixel of raster.ids) {
    const id = pixel >>> 16,
      bits = (pixel >>> 8) & 255;
    assert.equal(pixel & 255, 0, 'Country PNG reserved B must be zero');
    assert.ok(id === 0 || rasterIds.has(id), `Unknown country raster ID ${id}`);
    assert.equal(
      bits & ~allowedBits,
      0,
      'Padding uses only published stable metric bits',
    );
    assert.ok(id !== 0 || bits === 0, 'Ocean has no padding');
  }
  for (const metric of manifest.publishedMetrics) {
    const summary = manifest.padding[metric];
    const padded = new Set(
      summary.countries.map((country) => country.paletteIndex),
    );
    const observed = new Set();
    const mask = Buffer.alloc(raster.ids.length);
    const bit = 1 << manifest.metricBits[metric];
    for (let i = 0; i < mask.length; i += 1) {
      const pixel = raster.ids[i];
      if (((pixel >>> 8) & bit) !== 0) {
        const id = pixel >>> 16;
        assert.ok(padded.has(id), `${metric}: unlisted padding country ${id}`);
        observed.add(id);
        mask[i] = 1;
      }
    }
    assert.deepEqual(
      [...observed].sort((a, b) => a - b),
      [...padded].sort((a, b) => a - b),
    );
    assert.equal(
      createHash('sha256').update(mask).digest('hex'),
      manifest.determinism[metric].paddingSha256,
    );
    assert.equal(
      summary.maxFraction,
      Math.max(
        0,
        ...summary.countries.map((country) => country.paddingFraction),
      ),
    );
    for (const row of rows) {
      const entry = summary.countries.find((country) => country.id === row.id);
      const value = row.padding[metric];
      if (!entry)
        assert.equal(value, null, `${metric}: unexpected row padding`);
      else
        for (const [key, expected] of Object.entries(entry))
          assert.equal(
            value?.[key],
            expected,
            `${metric}: padding metadata differs for ${row.id}:${key}`,
          );
    }
    const name = `inverse-${metric}.bin`,
      asset = manifest.derivedAssets[name];
    const bytes = await readFile(reshapedPath(name, manifest));
    const field = await decodeInverse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { metric },
    );
    assert.equal(field.encoding, 'regular-node-float32');
    for (const key of [
      'metric',
      'width',
      'height',
      'encoding',
      'stepLongitude',
      'stepS',
    ])
      assert.equal(
        asset[key],
        field.header[key],
        `${metric}: header ${key} differs`,
      );
    assert.equal(asset.gpuBytes, inverseTextureBytes(field));
    assert.equal(manifest.determinism[metric].inverseSha256, asset.sha256);
  }
}

function estimateRuntimeDecodedBytes(asset, serializedBytes) {
  // Keep in sync with the fixed-vector-tested build/runtime estimator.
  const normalized = new Set();
  let aliasReferences = 0;
  for (const row of asset.rows) {
    for (const index of row.slice(6, 12)) {
      normalized.add(index === null ? '' : normalize(asset.strings[index]));
    }
    for (const index of row[12]) {
      normalized.add(normalize(asset.strings[index]));
      aliasReferences += 1;
    }
  }
  let normalizedBytes = 0;
  for (const value of normalized) normalizedBytes += 24 + value.length * 2;
  return (
    serializedBytes * 4 +
    normalizedBytes +
    asset.rows.length * (64 + 6 * 8 + 24) +
    aliasReferences * 8
  );
}

function normalize(value) {
  return value
    .trim()
    .toLocaleLowerCase('und')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
