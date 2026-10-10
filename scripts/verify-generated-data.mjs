import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { reshapedEarthManifestSchema } from '../src/data/manifestSchemas.ts';
import assert from 'node:assert/strict';
import { SOURCES } from './reshaped-earth/sources.mjs';
import { decodePngRgb } from '../src/features/reshaped/pngCore.mjs';
import { decodeInverse } from '../src/features/reshaped/inverseFormat.mjs';
import {
  inverseTextureBytes,
  reshapedMorphTextureBytes,
  measureAdaptiveEdgeContinuity,
} from '../src/features/reshaped/inverseSampling.mjs';
import {
  decodeUnits,
  decodeValues,
} from '../src/features/reshaped/metadata.mjs';

const reshapedMetrics = ['population', 'gdp', 'co2', 'lights'];
const reshapedLevels = ['country', 'admin1'];

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
  'boundary-adjustments.json',
  ...reshapedLevels.flatMap((level) => [
    `ids-${level}.png`,
    ...reshapedMetrics.map((metric) => `inverse-${metric}-${level}.bin`),
  ]),
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
      level: 9,
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
  assert.equal(manifest.formatVersion, 1, 'Manifest format version must be 1');
  assert.equal(manifest.year, 2020, 'Snapshot must be 2020');
  assert.equal(manifest.grid?.projection, 'cylindrical-equal-area');
  assert.ok([2048, 4096].includes(manifest.grid?.width));
  assert.equal(manifest.grid?.height, manifest.grid.width / 2);
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
    assert.ok(
      /^[a-f0-9]{64}$/.test(captured.sha256),
      `Source ${key} is not pinned`,
    );
    assert.ok(captured.rawBytes > 0, `Source ${key} needs captured size`);
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
  const unitAsset = {
    year: encodedUnits.year,
    units: decodeUnits(encodedUnits),
  };
  const valueAsset = {
    year: encodedValues.year,
    rows: decodeValues(encodedValues, unitAsset.units),
  };
  assert.equal(unitAsset.year, 2020);
  assert.equal(valueAsset.year, 2020);
  assert.ok(Array.isArray(unitAsset.units) && unitAsset.units.length > 0);
  assert.ok(Array.isArray(valueAsset.rows));
  const countryIds = new Set(
    countries.objects.countries.geometries.map(
      (geometry) => geometry.properties.countryId,
    ),
  );
  const units = new Map();
  const rasters = Object.fromEntries(
    reshapedLevels.map((level) => [level, new Set()]),
  );
  for (const unit of unitAsset.units) {
    assert.ok(
      unit.id && !units.has(unit.id),
      `Duplicate/invalid unit ${unit.id}`,
    );
    assert.ok(
      reshapedLevels.includes(unit.level),
      `Unit ${unit.id}: invalid level`,
    );
    assert.ok(
      countryIds.has(unit.parentCountryId),
      `Unit ${unit.id}: unknown country`,
    );
    if (unit.level === 'country') assert.equal(unit.id, unit.parentCountryId);
    assert.ok(
      Number.isInteger(unit.rasterId) &&
        unit.rasterId > 0 &&
        unit.rasterId <= 0xffffff,
    );
    assert.ok(
      !rasters[unit.level].has(unit.rasterId),
      `Duplicate ${unit.level} raster ID`,
    );
    rasters[unit.level].add(unit.rasterId);
    assert.ok(
      unit.name?.en && Number.isFinite(unit.areaKm2) && unit.areaKm2 >= 0,
    );
    assert.ok(Number.isInteger(unit.paletteIndex) && unit.paletteIndex > 0);
    if (unit.representativePoint !== null) {
      const point = unit.representativePoint;
      assert.ok(
        Number.isFinite(point?.latitude) && Math.abs(point.latitude) <= 90,
      );
      assert.ok(
        Number.isFinite(point?.longitude) && Math.abs(point.longitude) <= 180,
      );
    }
    if (
      unit.level === 'admin1' &&
      ['ne-156', 'ne-158'].includes(unit.parentCountryId)
    )
      assert.ok(
        /\p{Script=Han}/u.test(unit.name.zh ?? ''),
        `Unit ${unit.id}: Chinese name required`,
      );
    units.set(unit.id, unit);
  }
  const adminUnits = unitAsset.units.filter((unit) => unit.level === 'admin1');
  assert.equal(manifest.nameCoverage.admin1, adminUnits.length);
  assert.equal(
    manifest.nameCoverage.chinese,
    adminUnits.filter((unit) => unit.name.zh).length,
  );
  assert.equal(
    manifest.nameCoverage.fraction,
    manifest.nameCoverage.chinese / adminUnits.length,
  );
  assert.ok(
    Array.isArray(manifest.boundaryAdjustments),
    'Boundary adjustments must be recorded',
  );
  const snapshot = await loadJson('boundary-adjustments.json');
  assert.deepEqual(
    snapshot,
    manifest.boundaryAdjustments,
    'Boundary-adjustment snapshot must match the manifest',
  );
  const snapshotAsset = manifest.derivedAssets['boundary-adjustments.json'];
  assert.equal(snapshotAsset.kind, 'metadata');
  assert.equal(snapshotAsset.content, 'boundary-adjustments');
  assert.equal(snapshotAsset.gpuBytes, 0);
  for (const adjustment of snapshot) {
    assert.ok(['transfer', 'remnant'].includes(adjustment.type));
    assert.ok(
      countryIds.has(adjustment.targetCountryId),
      'Adjustment country must exist',
    );
    assert.ok(Number.isFinite(adjustment.areaKm2) && adjustment.areaKm2 > 0);
    assert.equal(typeof adjustment.needsReview, 'boolean');
    if (adjustment.type === 'transfer')
      assert.ok(
        Number.isFinite(adjustment.coverageFraction) &&
          adjustment.coverageFraction >= 0.95 &&
          adjustment.coverageFraction <= 1 + 1e-12,
      );
    else {
      const destination = units.get(adjustment.destinationUnitId);
      assert.ok(destination, 'Remnant destination must exist');
      assert.equal(destination.level, 'admin1');
      assert.equal(
        destination.parentCountryId,
        adjustment.targetCountryId,
        'Remnant destination must belong to the receiving country',
      );
    }
  }
  const rows = new Map();
  for (const row of valueAsset.rows) {
    assert.ok(
      units.has(row.id) && !rows.has(row.id),
      `Duplicate/unknown value row ${row.id}`,
    );
    assert.equal(row.level, units.get(row.id).level);
    assert.equal(row.year, 2020);
    for (const field of ['values', 'worldShare', 'areaRatio']) {
      assert.deepEqual(
        Object.keys(row[field]).sort(),
        [...reshapedMetrics].sort(),
      );
      for (const metric of reshapedMetrics) {
        const value = row[field][metric];
        assert.ok(
          value === null || (Number.isFinite(value) && value >= 0),
          `Invalid ${row.id} ${field}.${metric}`,
        );
        if (field === 'worldShare' && value !== null) assert.ok(value <= 1);
        if (row.values[metric] === null)
          assert.equal(
            value,
            null,
            `Missing ${row.id} ${metric} must stay null`,
          );
      }
    }
    rows.set(row.id, row);
  }
  assert.equal(rows.size, units.size, 'Every unit needs a value row');
  for (const metric of reshapedMetrics) {
    const aggregation = manifest.aggregation[metric];
    const diagnostics = aggregation.diagnostics;
    const assigned = adminUnits.reduce(
      (sum, unit) => sum + (rows.get(unit.id).values[metric] ?? 0),
      0,
    );
    const relative = (actual, expected) =>
      Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
    assert.ok(
      relative(assigned + diagnostics.unassigned, diagnostics.validTotal) <
        1e-9,
      `${metric}: conservation failed`,
    );
    assert.ok(relative(assigned, diagnostics.assignedTotal) < 1e-9);
    assert.ok(diagnostics.relativeError < 1e-9);
    assert.equal(manifest.unassigned[metric], diagnostics.unassignedFraction);
    assert.ok(
      relative(
        diagnostics.unassignedFraction,
        diagnostics.unassigned / diagnostics.validTotal,
      ) < 1e-12,
    );
    if (metric === 'population') {
      assert.ok(manifest.unassigned.population < 0.005);
      assert.ok(
        Math.abs(diagnostics.validTotal / 7.8e9 - 1) <= 0.02,
        'Population total differs from 2020 scale',
      );
    }
    if (metric === 'co2')
      assert.ok(
        Math.abs(diagnostics.validTotal / 34.3e9 - 1) <= 0.05,
        'CO2 total differs from 2020 scale',
      );
    for (const unit of unitAsset.units.filter(
      (candidate) => candidate.level === 'country',
    )) {
      const values = adminUnits
        .filter((child) => child.parentCountryId === unit.id)
        .map((child) => rows.get(child.id).values[metric]);
      const country = rows.get(unit.id).values[metric];
      if (values.every((value) => value === null)) assert.equal(country, null);
      else
        assert.ok(
          country !== null &&
            relative(
              values.reduce((sum, value) => sum + (value ?? 0), 0),
              country,
            ) < 1e-9,
          `${unit.id} ${metric}: country/child sums differ`,
        );
    }
  }
  for (const name of ['units.json', 'values.json']) {
    const asset = manifest.derivedAssets[name];
    assert.equal(asset.kind, 'metadata');
    assert.equal(asset.content, name.replace('.json', ''));
    assert.ok(asset.gzipBytes <= (name === 'units.json' ? 120 : 150) * 1024);
  }
  const inverseGpuBytes = [];
  for (const level of reshapedLevels) {
    const rasterAsset = manifest.derivedAssets[`ids-${level}.png`];
    assert.equal(rasterAsset.kind, 'id-raster');
    assert.equal(rasterAsset.level, level);
    assert.equal(rasterAsset.encoding, 'rgb24');
    assert.ok(
      rasterAsset.rawBytes <= 900 * 1024 && rasterAsset.gzipBytes <= 900 * 1024,
    );
    const bytes = await readFile(reshapedPath(`ids-${level}.png`, manifest));
    const raster = await decodePngRgb(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    assert.equal(raster.width, 4096);
    assert.equal(raster.height, 2048);
    assert.equal(rasterAsset.width, raster.width);
    assert.equal(rasterAsset.height, raster.height);
    assert.equal(rasterAsset.gpuBytes, raster.width * raster.height * 2);
    for (const id of raster.ids)
      assert.ok(
        id === 0 || rasters[level].has(id),
        `Unknown ${level} raster ID ${id}`,
      );
    for (const metric of reshapedMetrics) {
      const asset = manifest.derivedAssets[`inverse-${metric}-${level}.bin`];
      assert.equal(asset.kind, 'inverse-field');
      assert.ok(
        ['int16-meshopt', 'adaptive-quadtree-int16'].includes(asset.encoding),
      );
      const inverseBytes = await readFile(
        reshapedPath(`inverse-${metric}-${level}.bin`, manifest),
      );
      const field = await decodeInverse(
        inverseBytes.buffer.slice(
          inverseBytes.byteOffset,
          inverseBytes.byteOffset + inverseBytes.byteLength,
        ),
        { metric, level },
      );
      for (const key of [
        'metric',
        'level',
        'width',
        'height',
        'stepLongitude',
        'stepS',
        'verticalCoordinate',
        'stepLatitude',
      ])
        assert.equal(
          asset[key],
          field.header[key],
          `${metric}/${level}: header ${key} differs`,
        );
      if (asset.encoding === 'adaptive-quadtree-int16') {
        assert.equal(field.encoding, asset.encoding);
        for (const key of ['treeNodes', 'leafCount', 'maxDepth'])
          assert.equal(
            asset[key],
            field.header[key],
            `${metric}/${level}: header ${key} differs`,
          );
      } else assert.equal(field.encoding, 'regular-float32');
      assert.equal(asset.gpuBytes, inverseTextureBytes(field));
      inverseGpuBytes.push(asset.gpuBytes);
      assert.ok(asset.rawBytes <= (level === 'country' ? 4 : 8) * 1024 ** 2);
      assert.ok(asset.gzipBytes <= (level === 'country' ? 4 : 8) * 1024 ** 2);
      const acceptance = manifest.acceptance[`${metric}-${level}`];
      if (asset.encoding === 'adaptive-quadtree-int16') {
        const continuity = measureAdaptiveEdgeContinuity(field);
        assert.equal(
          continuity.balanced,
          true,
          `${metric}/${level}: adjacent leaves must be 2:1 balanced`,
        );
        assert.ok(
          continuity.maxDegrees < 0.01,
          `${metric}/${level}: encoded edge jump exceeds quantization tolerance`,
        );
        assert.equal(
          acceptance.edgeJumpMaxDegrees,
          continuity.maxDegrees,
          `${metric}/${level}: edge continuity measurement differs`,
        );
      }
      assert.equal(acceptance.triangleOrientation, true);
      for (const [key, limit] of Object.entries({
        medianAreaError: 0.05,
        p90AreaError: 0.15,
        roundTripP999Degrees: 0.05,
        roundTripMaxDegrees: 0.5,
        totalAreaRelativeError: 1e-6,
        quantizationMaxDegrees: 0.01,
      }))
        assert.ok(
          Number.isFinite(acceptance[key]) &&
            acceptance[key] >= 0 &&
            acceptance[key] < limit,
          `${metric}/${level}: ${key} exceeds ${limit}`,
        );
      assert.ok(
        Number.isInteger(acceptance.iterations) &&
          acceptance.iterations >= 1 &&
          acceptance.iterations <= 6,
      );
      assert.ok(
        Number.isInteger(acceptance.unitsChecked) &&
          acceptance.unitsChecked > 0,
      );
      assert.ok(
        ['gsm2018-fast-flow', 'composed-gsm2018-fast-flow'].includes(
          acceptance.algorithm,
        ),
      );
    }
  }
  const largestInverse = Math.max(...inverseGpuBytes);
  for (const level of reshapedLevels) {
    const maxId = Math.max(
      0,
      ...unitAsset.units
        .filter((unit) => unit.level === level)
        .map((unit) => unit.rasterId),
    );
    assert.ok(maxId <= 65535, 'GPU unit IDs must fit lossless RG8');
    assert.ok(
      reshapedMorphTextureBytes(largestInverse, largestInverse, maxId) <=
        40 * 1024 ** 2,
      'Both active fields, padded textures, RG8 IDs and RGBA32F palette must fit 40 MiB',
    );
  }
  assert.equal(Object.keys(manifest.acceptance).length, 8);
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
