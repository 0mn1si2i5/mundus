import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { inverseTextureBytesFromDescriptor } from '../features/reshaped/inverseSampling.mjs';
import {
  DATA_MANIFESTS,
  dataManifestSchema,
  reshapedEarthManifestSchema,
} from './registry';

// Synthetic manifests test rejection paths; they are not published cartograms.
function reshapedManifestFixture() {
  const metrics = ['population', 'gdp', 'co2', 'lights'];
  const sourceKeys = [...metrics, 'admin1', 'chn', 'default'];
  const identity = (name: string) => ({
    path: `src/data/generated/reshaped-earth/${name}`,
    sha256: 'a'.repeat(64),
    rawBytes: 1024,
    gzipBytes: 512,
    gpuBytes: 0,
  });
  const derivedAssets: Record<string, unknown> = {};
  for (const content of ['units', 'values'])
    derivedAssets[`${content}.json`] = {
      ...identity(`${content}.json`),
      kind: 'metadata',
      content,
    };
  derivedAssets['ids-country.png'] = {
    ...identity('ids-country.png'),
    kind: 'id-raster',
    width: 4096,
    height: 2048,
    encoding: 'country-padding-rg8',
    gpuBytes: 4096 * 2048 * 2,
  };
  for (const metric of metrics)
    derivedAssets[`inverse-${metric}.bin`] = {
      ...identity(`inverse-${metric}.bin`),
      kind: 'inverse-field',
      metric,
      width: 1024,
      height: 512,
      encoding: 'regular-node-int16',
      stepLongitude: 0.001,
      stepS: 0.00001,
      gpuBytes: inverseTextureBytesFromDescriptor({ width: 1024, height: 512 }),
    };
  return reshapedEarthManifestSchema.parse({
    id: 'reshaped-earth',
    sourceName: 'Synthetic manifest contract fixture',
    sourceUrl: 'https://example.com/source',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    version: 'synthetic',
    retrievedAt: '2026-10-10',
    attribution: 'Synthetic source',
    redistribution: 'allowed',
    transformations: ['synthetic schema test'],
    missingValuePolicy: 'null remains missing',
    boundaryPolicy: 'Mundus view',
    formatVersion: 4,
    publishedMetrics: metrics,
    unpublishedMetrics: [],
    metricBits: { population: 0, gdp: 1, co2: 2, lights: 3 },
    year: 2020,
    grid: { projection: 'cylindrical-equal-area', width: 2048, height: 1024 },
    sources: sourceKeys.map((key) => ({
      id: key,
      name: key,
      url: 'https://example.com/source',
      license: 'CC BY 4.0',
      ...(metrics.includes(key) ? { year: 2020 } : {}),
    })),
    sourceAssets: Object.fromEntries(
      sourceKeys.map((key) => [
        key,
        {
          key,
          published: true,
          fileName: `${key}.source`,
          distributionUrl: 'https://example.com/source',
          sha256: 'b'.repeat(64),
          rawBytes: 1024,
          licenseName: 'CC BY 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
          version: 'synthetic',
          retrievedAt: '2026-10-10',
          selection: 'synthetic schema test',
          ...(metrics.includes(key) ? { year: 2020 } : {}),
        },
      ]),
    ),
    derivedAssets,
    acceptance: Object.fromEntries(
      metrics.map((metric) => [
        metric,
        {
          triangleOrientation: true,
          minimumTriangleArea: 1e-8,
          medianAreaError: 0.01,
          p90AreaError: 0.03,
          rawMedianAreaError: 0.01,
          rawP90AreaError: 0.03,
          totalAreaRelativeError: 1e-10,
          quantizationMaxDegrees: 0.005,
          iterations: 2,
          unitsChecked: 100,
          displaySamples: 400_000,
          displaySeed: 17,
          displayP50Degrees: 0.001,
          displayP99Degrees: 0.01,
          displayP999Degrees: 0.02,
          displayMaxDegrees: 0.04,
        },
      ]),
    ),
    parameters: Object.fromEntries(
      metrics.map((metric) => [
        metric,
        {
          algorithm: 'gsm2018-fast-flow',
          grid: [2048, 1024],
          initialBlur: 32,
          blurSchedule: [32, 16],
          integrationTolerance: 0.02 / 2048,
          maxRounds: 16,
          stopReason: 'raw-pass',
          minimumJacobian: 0.001,
          regularizationPasses: 8,
          quantization: {
            rule: 'minimum-gzip6-among-15-choices-with-source-quantization-lt-0.01-and-display-p99-le-0.1-p999-le-0.5',
            stepLongitudeFactor: 2,
            stepSFactor: 1,
            stepLongitude: 0.001,
            stepS: 0.00001,
          },
        },
      ]),
    ),
    determinism: Object.fromEntries(
      metrics.map((metric) => [
        metric,
        {
          builds: 2,
          byteIdentical: true,
          forwardSha256: 'c'.repeat(64),
          inverseSha256: 'a'.repeat(64),
          paddingSha256: 'd'.repeat(64),
        },
      ]),
    ),
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
    nameCoverage: { countries: 239, chinese: 239, fraction: 1 },
    unassigned: Object.fromEntries(metrics.map((metric) => [metric, 0.001])),
    aggregation: Object.fromEntries(
      metrics.map((metric) => [
        metric,
        {
          published: true,
          diagnostics: {
            validTotal: 1000,
            assignedTotal: 999,
            unassigned: 1,
            relativeError: 0,
            unassignedFraction: 0.001,
          },
          metadata: { year: 2020 },
        },
      ]),
    ),
  });
}

describe('data registry', () => {
  it('contains valid manifests with unique ids', () => {
    const ids = DATA_MANIFESTS.map((manifest) => manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'mundus-countries',
      'natural-earth-vector-globe',
      'geonames-major-cities',
      'surnames-by-country',
      'country-label-anchors',
      'surname-label-slots',
      'surname-coverage',
      'urban-isolation',
      'reshaped-earth',
    ]);
    expect(
      DATA_MANIFESTS.every(
        (manifest) => dataManifestSchema.safeParse(manifest).success,
      ),
    ).toBe(true);
  });

  it('pins the Mundus country boundary view and its sources', () => {
    const manifest = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'mundus-countries',
    );
    expect(manifest).toMatchObject({
      version: 'Natural Earth 5.1.2',
      sha256:
        'a13bf5f310fde87bc0a5f994f8ce9bd706cc198d8ee37d221e61c2546b945372',
      auxiliarySources: [
        expect.objectContaining({
          sha256:
            '239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255',
        }),
      ],
      topologyAssets: {
        '110m': {
          sha256:
            '9b69ff70741a75a43c3aa31d2e01c35eea6bea93bc0ab2878f3aca7faea07647',
          countries: 174,
        },
        '50m': {
          sha256:
            'b5f8a7f4428ead23409572525e1ca6dc5ea9c06d0f72f3dbe9315b0bba9fede4',
          countries: 239,
        },
      },
    });
    expect(manifest?.boundaryPolicy).toContain('China point of view');
  });

  it('pins both vector resolutions and their transfer and GPU budgets', () => {
    const manifest = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'natural-earth-vector-globe',
    );
    expect(manifest?.sourceAssets).toMatchObject({
      '110m': {
        sha256:
          '9b69ff70741a75a43c3aa31d2e01c35eea6bea93bc0ab2878f3aca7faea07647',
      },
      '50m': {
        sha256:
          'b5f8a7f4428ead23409572525e1ca6dc5ea9c06d0f72f3dbe9315b0bba9fede4',
      },
    });
    const low = manifest?.derivedAssets?.['110m'];
    const high = manifest?.derivedAssets?.['50m'];
    if (
      !low ||
      !high ||
      !('runtimeGpuBytes' in low) ||
      !('runtimeGpuBytes' in high)
    )
      throw new Error('Natural Earth assets must use their vector schema');
    expect(low.gpuBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(high.gpuBytes).toBeLessThanOrEqual(24 * 1024 * 1024);
    expect(high.gzipBytes).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    expect(low.droppedOutsideAreaFraction).toBeLessThan(0.0001);
    expect(high.droppedOutsideAreaFraction).toBeLessThan(0.0001);
    expect(high.runtimeGpuBytes).toBe(high.gpuBytes);
  });

  it('registers accepted country-only v4 cartograms under their dedicated contract', () => {
    const manifest = reshapedManifestFixture();
    const published = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'reshaped-earth',
    );
    expect(published).toBeDefined();
    expect(published).toEqual(reshapedEarthManifestSchema.parse(published));
    expect(manifest.formatVersion).toBe(4);
    expect(Object.keys(manifest.derivedAssets)).toHaveLength(7);
    expect(Object.keys(manifest.acceptance)).toEqual([
      'population',
      'gdp',
      'co2',
      'lights',
    ]);
    expect(manifest.nameCoverage).toEqual({
      countries: 239,
      chinese: 239,
      fraction: 1,
    });
    expect(manifest.sourceAssets.admin1).toBeDefined();
    expect(manifest).not.toHaveProperty('boundaryAdjustments');
    for (const field of Object.values(manifest.acceptance)) {
      expect(field.displaySamples).toBeGreaterThanOrEqual(400_000);
      expect(field.displayP99Degrees).toBeLessThanOrEqual(0.1);
      expect(field.displayP999Degrees).toBeLessThanOrEqual(0.5);
    }
  });

  it('rejects missing assets, stale formats and removed admin/adaptive data', () => {
    const manifest = reshapedManifestFixture();
    const missing = structuredClone(manifest);
    delete missing.derivedAssets['inverse-co2.bin'];
    const old = structuredClone(manifest);
    Object.assign(old, { formatVersion: 1 });
    const wrongDimensions = structuredClone(manifest);
    Object.assign(wrongDimensions.derivedAssets['inverse-gdp.bin']!, {
      width: 512,
    });
    const legacy = structuredClone(manifest);
    Object.assign(legacy, { boundaryAdjustments: [], materialMeshes: {} });
    const adaptive = structuredClone(manifest);
    Object.assign(adaptive.derivedAssets['inverse-population.bin']!, {
      encoding: 'adaptive-quadtree-int16',
      treeNodes: 1,
    });
    const admin = structuredClone(manifest);
    admin.derivedAssets['ids-admin1.png'] = structuredClone(
      admin.derivedAssets['ids-country.png']!,
    );
    for (const invalid of [
      missing,
      old,
      wrongDimensions,
      legacy,
      adaptive,
      admin,
    ])
      expect(dataManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects failed numerical or deterministic acceptance and accepts the inclusive display limits', () => {
    const manifest = reshapedManifestFixture();
    for (const [field, value] of Object.entries({
      medianAreaError: 0.05,
      p90AreaError: 0.15,
      displayP99Degrees: 0.100001,
      displayP999Degrees: 0.500001,
      quantizationMaxDegrees: 0.01,
      totalAreaRelativeError: 1e-6,
      minimumTriangleArea: 0,
      unitsChecked: 0,
      displaySamples: 399_999,
    })) {
      const invalid = structuredClone(manifest);
      Object.assign(invalid.acceptance.population!, { [field]: value });
      expect(dataManifestSchema.safeParse(invalid).success, field).toBe(false);
    }
    const boundary = structuredClone(manifest);
    Object.assign(boundary.acceptance.population!, {
      displayP99Degrees: 0.1,
      displayP999Degrees: 0.5,
      displayMaxDegrees: 1,
    });
    expect(dataManifestSchema.safeParse(boundary).success).toBe(true);
    const nondeterministic = structuredClone(manifest);
    Object.assign(nondeterministic.determinism.gdp!, { byteIdentical: false });
    const wrongHash = structuredClone(manifest);
    wrongHash.determinism.gdp!.inverseSha256 = 'd'.repeat(64);
    const schedule = structuredClone(manifest);
    schedule.parameters.gdp!.blurSchedule.pop();
    const wrongSteps = structuredClone(manifest);
    wrongSteps.parameters.gdp!.quantization.stepS = 0.0001;
    const wrongChoice = structuredClone(manifest);
    wrongChoice.parameters.gdp!.quantization.stepLongitudeFactor = 3;
    const wrongRule = structuredClone(manifest);
    Object.assign(wrongRule.parameters.gdp!.quantization, { rule: 'manual' });
    for (const invalid of [
      nondeterministic,
      wrongHash,
      schedule,
      wrongSteps,
      wrongChoice,
      wrongRule,
    ])
      expect(dataManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts three published metrics while retaining GDP provenance and its stable empty bit', () => {
    const manifest = reshapedManifestFixture();
    manifest.publishedMetrics = ['population', 'co2', 'lights'];
    manifest.unpublishedMetrics = ['gdp'];
    manifest.sources = manifest.sources.filter((source) => source.id !== 'gdp');
    manifest.sourceAssets.gdp!.published = false;
    manifest.aggregation.gdp.published = false;
    delete manifest.derivedAssets['inverse-gdp.bin'];
    delete manifest.acceptance.gdp;
    delete manifest.parameters.gdp;
    delete manifest.determinism.gdp;
    delete manifest.padding.gdp;
    expect(dataManifestSchema.safeParse(manifest).success).toBe(true);
    const phantom = structuredClone(manifest);
    phantom.padding.gdp = {
      countries: [],
      skippedCountries: [],
      maxFraction: 0,
      algorithm: 'spherical-chamfer-8',
      triggerRatio: 1.1,
      minimumPixels: 64,
    };
    expect(dataManifestSchema.safeParse(phantom).success).toBe(false);
    const wrongBits = structuredClone(manifest);
    Object.assign(wrongBits.metricBits, { co2: 1 });
    expect(dataManifestSchema.safeParse(wrongBits).success).toBe(false);
  });

  it('checks gzip-6 and raw limits separately and counts both transition inverse textures', () => {
    const manifest = reshapedManifestFixture();
    const inverse = manifest.derivedAssets['inverse-population.bin']!;
    if (inverse.kind !== 'inverse-field')
      throw new Error('Wrong inverse asset type');
    inverse.rawBytes = 1_200_000;
    inverse.gzipBytes = 700_000;
    expect(dataManifestSchema.safeParse(manifest).success).toBe(true);
    const raw = structuredClone(manifest);
    raw.derivedAssets['inverse-population.bin']!.rawBytes += 1;
    const gzip = structuredClone(manifest);
    gzip.derivedAssets['inverse-population.bin']!.gzipBytes += 1;
    const metadata = structuredClone(manifest);
    metadata.derivedAssets['units.json']!.gzipBytes = 60_000;
    const png = structuredClone(manifest);
    png.derivedAssets['ids-country.png']!.rawBytes = 900_001;
    const gpu = structuredClone(manifest);
    gpu.derivedAssets['inverse-population.bin']!.gpuBytes -= 1;
    for (const invalid of [raw, gzip, metadata, png, gpu])
      expect(dataManifestSchema.safeParse(invalid).success).toBe(false);
    const oversizedTransition = structuredClone(manifest);
    oversizedTransition.derivedAssets['inverse-population.bin']!.gpuBytes =
      15 * 1024 ** 2;
    const parsed = dataManifestSchema.safeParse(oversizedTransition);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        'Current and preceding inverses, RG8 IDs and palette exceed 40 MiB',
      );
  });

  it('contains no retired populated-place pipeline', () => {
    for (const path of [
      'src/features/antipodes/populatedPlaces.ts',
      'src/data/generated/natural-earth-populated-places-50m.json',
      'src/data/manifests/natural-earth-populated-places-50m.json',
      'scripts/build-populated-places.mjs',
    ]) {
      expect(existsSync(path), path).toBe(false);
    }
  });

  it('requires exactly runtime format v2 for the GeoNames derived asset only', () => {
    const geoNames = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'geonames-major-cities',
    )!;
    const withoutFormat = structuredClone(geoNames);
    delete withoutFormat.derivedAsset?.formatVersion;
    const versionOne = structuredClone(geoNames);
    versionOne.derivedAsset!.formatVersion = 1;

    expect(dataManifestSchema.safeParse(withoutFormat).success).toBe(false);
    expect(dataManifestSchema.safeParse(versionOne).success).toBe(false);
    expect(dataManifestSchema.safeParse(geoNames).success).toBe(true);
  });

  it('pins the licensed GeoNames major-city snapshot and derived budgets', () => {
    const manifest = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'geonames-major-cities',
    );

    expect(manifest).toMatchObject({
      sourceName: 'GeoNames geographical database',
      licenseName: 'CC BY 4.0',
      upstreamCapture: {
        retrievedAt: expect.stringMatching(/^2026-08-01T/),
        sources: expect.arrayContaining([
          expect.objectContaining({
            distributionUrl:
              'https://download.geonames.org/export/dump/cities15000.zip',
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ]),
      },
      immutableBuildInput: {
        path: 'src/data/generated/geonames-major-cities-input.json',
        schemaVersion: 2,
        sha256:
          '49b3f2114d1e71277572b2773cb1e5b8242f3eb22a9e89598eb95b79408c5621',
        rawBytes: 2814375,
      },
      derivedAsset: {
        path: 'src/data/generated/geonames-major-cities.json',
        formatVersion: 2,
        sha256:
          '68d971df7d66f16eb23a1921623f4608176ed36ec8bb4ac00d1ba57d7493dfab',
        rawBytes: 793910,
      },
      attribution: 'Contains GeoNames data, licensed under CC BY 4.0',
      recordCount: 6953,
      rawBytes: 793910,
      gzipBytes: 277460,
      staticDecodedBytesEstimate: 3175640,
      runtimeDecodedBytesEstimate: 4819938,
    });
    expect(manifest).not.toHaveProperty('distributionUrl');
    expect(manifest).not.toHaveProperty('sha256');
    expect(
      manifest?.upstreamCapture?.sources.map((source) => source.sha256),
    ).toEqual([
      '9ba4c24f8b514081139a813be393f2f01e98a7a059e5f3ac8c96c786bf532481',
      'd46fc26c590c29e663792dd9bc5dc07322ee99567681ee45ee0df9f935c04204',
      '93bafc525813f22e4711ff9ed6d626343094ce48c26388dc7c49189b3d7d5512',
      '34784457b76b988a669dff7c3e4b104e4902c0875643cff019281ac79dfa2992',
      'b1957379b6c1242c700c98ac9a8aa0a09f56c3c0a50ee72175527005f48ef2c5',
    ]);
    expect(manifest?.recordCount).toBeLessThanOrEqual(10_000);
    expect(manifest?.rawBytes).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    expect(manifest?.gzipBytes).toBeLessThanOrEqual(450 * 1024);
    expect(manifest?.runtimeDecodedBytesEstimate).toBeLessThanOrEqual(
      8 * 1024 * 1024,
    );
  });

  it('pins the bounded community surname observation asset', () => {
    const manifest = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'surnames-by-country',
    );
    expect(manifest).toMatchObject({
      version: expect.stringContaining('v1.2'),
      licenseName: expect.stringMatching(/CC0.*Apache-2\.0/u),
      derivedAssetSha256:
        '8460a04feb0d63a4111247630a029de184aa64d1852236354a46b513f96dffdd',
      recordCount: 287,
      rawBytes: 93055,
      gzipBytes: 7144,
      staticDecodedBytesEstimate: 372220,
    });
    expect(manifest?.auxiliarySources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: 'Statistics Sweden surname ranking supplement',
          sha256:
            '8e5d469eabd46e67174b45bfccc73d2097a93af1e88b199694e78a5a196e4ad9',
        }),
        expect.objectContaining({
          sourceName: 'Wikipedia European surname list, Sweden section',
          sha256:
            'c5fbe91365197c28ab8b3c200ce69ef08ea0bf098b9dc81ba2c77e9cd0dff60b',
        }),
        expect.objectContaining({
          sourceName: 'African source-listed surname observations',
          sha256:
            '118665614e9acb4df31ecdd540b0513d3371d6e0bd548b95918321dafe9a7d51',
        }),
      ]),
    );
    expect(manifest?.rawBytes).toBeLessThan(200 * 1024);
    expect(manifest?.runtimeDecodedBytesEstimate).toBeLessThan(2 * 1024 * 1024);
  });

  it('pins the cross-resolution country label anchors', () => {
    const manifest = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'country-label-anchors',
    );
    expect(manifest).toMatchObject({
      derivedAssetSha256:
        'ce1077dc8e85b6de82705af5ec1f530f3d975dbbe9b0db82fa67f9117602f996',
      recordCount: 239,
      rawBytes: 22493,
      gzipBytes: 5077,
      sourceAssets: {
        '50m': {
          sha256:
            'b5f8a7f4428ead23409572525e1ca6dc5ea9c06d0f72f3dbe9315b0bba9fede4',
        },
        '110m': {
          sha256:
            '9b69ff70741a75a43c3aa31d2e01c35eea6bea93bc0ab2878f3aca7faea07647',
        },
      },
    });
    expect(manifest?.rawBytes).toBeLessThan(64 * 1024);
  });

  it('pins the compact surname candidate asset', () => {
    const manifest = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'surname-label-slots',
    );
    expect(manifest).toMatchObject({
      derivedAssetSha256:
        '74f895d06453724ff155d615f4aec0a28b715585aa5f1efc77d6949d9bb0af33',
      recordCount: 1106,
      rawBytes: 687239,
      sourceAssets: {
        '50m': {
          sha256:
            'b5f8a7f4428ead23409572525e1ca6dc5ea9c06d0f72f3dbe9315b0bba9fede4',
        },
      },
    });
  });

  it('pins the complete surname coverage audit', () => {
    const manifest = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'surname-coverage',
    );
    expect(manifest).toMatchObject({
      derivedAssetSha256:
        '9eb24c8570a85a1bab0cc07e011560f57bd98f63d9ece9b8d3a300af72921632',
      recordCount: 239,
      rawBytes: 25915,
    });
  });
});
