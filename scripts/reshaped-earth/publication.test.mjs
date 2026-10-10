import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assertProductionFields,
  buildIdRasters,
  publishProductionAssets,
} from './publication.mjs';
import { decodeRgbPng } from './png.mjs';

const fingerprint = 'f'.repeat(64);
function fields() {
  return Object.fromEntries(
    ['population', 'gdp', 'co2', 'lights'].map((key) => [
      key,
      {
        passes: true,
        fingerprint,
        inverseSha256: 'a'.repeat(64),
        paddingSha256: 'c'.repeat(64),
        determinism: {
          builds: 2,
          byteIdentical: true,
          forwardSha256: 'b'.repeat(64),
          inverseSha256: 'a'.repeat(64),
          paddingSha256: 'c'.repeat(64),
        },
      },
    ]),
  );
}

test('publication refuses partial, stale or unverified rebuilds before touching assets', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'mundus-publication-gate-'));
  try {
    const missing = fields();
    delete missing.co2;
    const stale = fields();
    stale.population.fingerprint = 'old';
    const failed = fields();
    failed.co2.passes = false;
    const nondeterministic = fields();
    nondeterministic.gdp.determinism.byteIdentical = false;
    const mismatched = fields();
    mismatched.lights.determinism.inverseSha256 = 'c'.repeat(64);
    for (const invalid of [
      missing,
      stale,
      failed,
      nondeterministic,
      mismatched,
    ])
      await assert.rejects(
        publishProductionAssets({ cacheDir, fields: invalid, fingerprint }),
      );
    assert.deepEqual(await readdir(cacheDir), []);
    assert.doesNotThrow(() => assertProductionFields(fields(), fingerprint));
    const three = fields();
    three.gdp.passes = false;
    three.gdp.published = false;
    assert.doesNotThrow(() => assertProductionFields(three, fingerprint));
  } finally {
    await rm(cacheDir, { recursive: true });
  }
});

test('country publication preserves classified coastal ownership without publishing admin IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-country-raster-'));
  try {
    const labelPath = join(directory, 'labels.u16');
    const labels = Buffer.alloc(8);
    [1, 2, 3, 0].forEach((label, i) => labels.writeUInt16LE(label, i * 2));
    await writeFile(labelPath, labels);
    const classification = {
      width: 2,
      height: 2,
      labelPath,
      countries: [{ id: 'country-a' }, { id: 'country-b' }],
      adminToCountryIndex: new Uint16Array([0, 1, 1, 2]),
    };
    const population = new Uint8Array(4096 * 2048),
      gdp = new Uint8Array(population.length),
      lights = new Uint8Array(population.length);
    population[0] = 1;
    gdp[0] = 1;
    lights[(2048 - 1) * 4096] = 1;
    const assets = await buildIdRasters(classification, {
      population,
      gdp,
      lights,
    });
    assert.deepEqual(Object.keys(assets), ['ids-country.png']);
    const { width, height, data } = decodeRgbPng(assets['ids-country.png']);
    const id = (x, y) => {
      const i = (y * width + x) * 3;
      return data[i];
    };
    assert.equal(width, 4096);
    assert.equal(height, 2048);
    assert.equal(id(0, 0), 1);
    assert.equal(id(width - 1, 0), 1);
    assert.equal(id(0, height - 1), 2);
    assert.equal(id(width - 1, height - 1), 0);
    assert.equal(data[1], 3, 'population/GDP keep bits 0/1');
    assert.equal(
      data[(height - 1) * width * 3 + 1],
      8,
      'lights keeps stable bit 3',
    );
    assert.equal(data[2], 0, 'B is reserved');
    const ocean = new Uint8Array(population.length);
    ocean[ocean.length - 1] = 1;
    await assert.rejects(
      buildIdRasters(classification, { co2: ocean }),
      /Ocean cannot contain padding/u,
    );
    assert.ok(assets['ids-country.png'].length <= 900_000);
  } finally {
    await rm(directory, { recursive: true });
  }
});

// Synthetic accepted records exercise the publication contract; they are never
// written to generated/ and do not stand in for scientific production evidence.
test('candidate verifier accepts MRE3/gzip-6 identities and rejects altered bytes', async () => {
  const { createHash } = await import('node:crypto');
  const { gzipSync } = await import('node:zlib');
  const { readFile } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const { MeshoptEncoder } = await import('meshoptimizer/encoder');
  const { SOURCES } = await import('./sources.mjs');
  const { writeRgbPng } = await import('./png.mjs');
  const { reshapedEarthManifestSchema } =
    await import('../../src/data/manifestSchemas.ts');
  const directory = await mkdtemp(join(tmpdir(), 'mundus-candidate-verifier-'));
  try {
    const metrics = ['population', 'gdp', 'co2', 'lights'];
    const countries = JSON.parse(
      await readFile('src/data/generated/mundus-countries-50m.json', 'utf8'),
    );
    const units = countries.objects.countries.geometries.map((geometry, i) => ({
      id: geometry.properties.countryId,
      rasterId: i + 1,
      paletteIndex: i + 1,
      name: { en: `Country ${i}`, zh: `国家 ${i}` },
      areaKm2: 1,
      representativePoint: { latitude: 0, longitude: 0 },
      excluded: geometry.properties.countryId === 'ne-010',
    }));
    const totals = { population: 7.8e9, gdp: 1e12, co2: 34.3e9, lights: 1e8 };
    const rows = units.map((unit) => ({
      id: unit.id,
      year: 2020,
      values: Object.fromEntries(
        metrics.map((key) => [key, unit.excluded ? null : totals[key] / 238]),
      ),
      worldShare: Object.fromEntries(
        metrics.map((key) => [key, unit.excluded ? null : 1 / 238]),
      ),
      padding: Object.fromEntries(metrics.map((key) => [key, null])),
      areaRatio: Object.fromEntries(
        metrics.map((key) => [key, unit.excluded ? null : 1]),
      ),
    }));
    const unitBytes = Buffer.from(
      JSON.stringify({
        formatVersion: 4,
        encoding: 'country-json',
        year: 2020,
        units,
      }) + '\n',
    );
    const valueBytes = Buffer.from(
      JSON.stringify({
        formatVersion: 4,
        encoding: 'country-json',
        year: 2020,
        metrics,
        totals,
        sourceIds: Object.fromEntries(
          metrics.map((key) => [key, SOURCES[key].id]),
        ),
        rows,
      }) + '\n',
    );
    const pixels = new Uint8Array(4096 * 2048 * 3);
    pixels[0] = 1;
    const png = writeRgbPng(4096, 2048, pixels);
    const derivedAssets = {};
    const assetBytes = {};
    const add = async (name, bytes, descriptor) => {
      await writeFile(join(directory, name), bytes);
      assetBytes[name] = bytes;
      derivedAssets[name] = {
        path: `src/data/generated/reshaped-earth/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        rawBytes: bytes.length,
        gzipBytes: gzipSync(bytes, { level: 6 }).length,
        ...descriptor,
      };
    };
    await add('units.json', unitBytes, {
      kind: 'metadata',
      content: 'units',
      gpuBytes: 0,
    });
    await add('values.json', valueBytes, {
      kind: 'metadata',
      content: 'values',
      gpuBytes: 0,
    });
    await add('ids-country.png', png, {
      kind: 'id-raster',
      width: 4096,
      height: 2048,
      encoding: 'country-padding-rg8',
      gpuBytes: 4096 * 2048 * 2,
    });
    await MeshoptEncoder.ready;
    const encoded = MeshoptEncoder.encodeVertexBuffer(
      new Uint8Array(1025 * 513 * 4),
      1025 * 513,
      4,
    );
    for (const metric of metrics) {
      const header = Buffer.from(
        JSON.stringify({
          formatVersion: 3,
          encoding: 'regular-node-int16',
          metric,
          width: 1024,
          height: 512,
          stepLongitude: 0.01,
          stepS: 0.00001,
          stride: 4,
          encodedBytes: encoded.length,
        }),
      );
      const prefix = Buffer.alloc(8);
      prefix.write('MRE3');
      prefix.writeUInt32LE(header.length, 4);
      await add(
        `inverse-${metric}.bin`,
        Buffer.concat([prefix, header, encoded]),
        {
          kind: 'inverse-field',
          metric,
          width: 1024,
          height: 512,
          encoding: 'regular-node-int16',
          stepLongitude: 0.01,
          stepS: 0.00001,
          gpuBytes: 1025 * 513 * 8,
        },
      );
    }
    const sourceAssets = Object.fromEntries(
      Object.entries(SOURCES).map(([key, source]) => [
        key,
        {
          key,
          published: true,
          fileName: source.fileName,
          distributionUrl: source.url,
          sha256: source.sha256,
          rawBytes: source.bytes ?? 1,
          licenseName: source.licence,
          licenseUrl: source.licenceUrl,
          version: source.version,
          retrievedAt: source.retrievedAt,
          selection: source.selection,
          ...(source.year ? { year: 2020 } : {}),
        },
      ]),
    );
    const manifest = reshapedEarthManifestSchema.parse({
      id: 'reshaped-earth',
      formatVersion: 4,
      sourceName: 'Synthetic verifier test',
      sourceUrl: 'https://example.com',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      version: 'synthetic',
      retrievedAt: '2026-10-10',
      attribution: 'Synthetic verifier test',
      redistribution: 'allowed',
      transformations: ['synthetic identity'],
      missingValuePolicy: 'null stays missing',
      boundaryPolicy: 'Mundus view',
      year: 2020,
      grid: { projection: 'cylindrical-equal-area', width: 2048, height: 1024 },
      sources: Object.values(SOURCES).map((source) => ({
        id: source.id,
        name: source.id,
        url: source.landingUrl,
        license: source.licence,
        ...(source.year ? { year: 2020 } : {}),
      })),
      sourceAssets,
      publishedMetrics: metrics,
      unpublishedMetrics: [],
      metricBits: { population: 0, gdp: 1, co2: 2, lights: 3 },
      padding: Object.fromEntries(
        metrics.map((metric) => [
          metric,
          {
            countries: [],
            skippedCountries: [],
            maxFraction: 0,
            algorithm: 'spherical-chamfer-8',
            triggerRatio: 1.1,
            minimumPixels: 64,
          },
        ]),
      ),
      derivedAssets,
      nameCoverage: { countries: 239, chinese: 239, fraction: 1 },
      acceptance: Object.fromEntries(
        metrics.map((key) => [
          key,
          {
            triangleOrientation: true,
            minimumTriangleArea: 1e-8,
            medianAreaError: 0.01,
            p90AreaError: 0.03,
            rawMedianAreaError: 0.01,
            rawP90AreaError: 0.03,
            totalAreaRelativeError: 1e-10,
            quantizationMaxDegrees: 0,
            iterations: 1,
            unitsChecked: 239,
            displaySamples: 400_000,
            displaySeed: 17,
            displayP50Degrees: 0,
            displayP99Degrees: 0,
            displayP999Degrees: 0,
            displayMaxDegrees: 0,
          },
        ]),
      ),
      parameters: Object.fromEntries(
        metrics.map((key) => [
          key,
          {
            algorithm: 'gsm2018-fast-flow',
            grid: [2048, 1024],
            initialBlur: 32,
            blurSchedule: [32],
            integrationTolerance: 0.02 / 2048,
            maxRounds: 16,
            stopReason: 'raw-pass',
            minimumJacobian: 0.001,
            regularizationPasses: 8,
            quantization: {
              rule: 'minimum-gzip6-among-15-choices-with-source-quantization-lt-0.01-and-display-p99-le-0.1-p999-le-0.5',
              stepLongitudeFactor: 2,
              stepSFactor: 1,
              stepLongitude: 0.01,
              stepS: 0.00001,
            },
          },
        ]),
      ),
      determinism: Object.fromEntries(
        metrics.map((key) => [
          key,
          {
            builds: 2,
            byteIdentical: true,
            forwardSha256: 'b'.repeat(64),
            inverseSha256: derivedAssets[`inverse-${key}.bin`].sha256,
            paddingSha256: createHash('sha256')
              .update(Buffer.alloc(4096 * 2048))
              .digest('hex'),
          },
        ]),
      ),
      unassigned: Object.fromEntries(metrics.map((key) => [key, 0])),
      aggregation: Object.fromEntries(
        metrics.map((key) => [
          key,
          {
            published: true,
            diagnostics: {
              validTotal: totals[key],
              assignedTotal: totals[key],
              unassigned: 0,
              relativeError: 0,
              unassignedFraction: 0,
            },
            metadata: { year: 2020 },
          },
        ]),
      ),
    });
    const manifestPath = join(directory, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const verify = () =>
      spawnSync(
        process.execPath,
        [
          'scripts/verify-generated-data.mjs',
          '--reshaped-manifest',
          manifestPath,
          '--reshaped-assets',
          directory,
        ],
        { encoding: 'utf8', maxBuffer: 1_000_000 },
      );
    const valid = verify();
    assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
    await writeFile(join(directory, 'inverse-gdp.bin'), Buffer.from('changed'));
    const corrupt = verify();
    assert.equal(corrupt.status, 1);
    assert.match(corrupt.stderr, /expected .*received/u);
    await writeFile(
      join(directory, 'inverse-gdp.bin'),
      assetBytes['inverse-gdp.bin'],
    );
    manifest.derivedAssets['units.json'].gzipBytes += 1;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const wrongGzip = verify();
    assert.equal(wrongGzip.status, 1);
    assert.match(wrongGzip.stderr, /gzip bytes/u);
  } finally {
    await rm(directory, { recursive: true });
  }
});
