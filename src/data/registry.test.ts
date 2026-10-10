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
  const levels = ['country', 'admin1'];
  const identity = (name: string) => ({
    path: `src/data/generated/reshaped-earth/${name}`,
    sha256: 'a'.repeat(64),
    rawBytes: 1024,
    gzipBytes: 512,
    gpuBytes: 0,
  });
  const derivedAssets: Record<string, unknown> = {};
  const acceptance: Record<string, unknown> = {};
  for (const content of ['units', 'values', 'boundary-adjustments'])
    derivedAssets[`${content}.json`] = {
      ...identity(`${content}.json`),
      kind: 'metadata',
      content,
    };
  for (const level of levels) {
    derivedAssets[`ids-${level}.png`] = {
      ...identity(`ids-${level}.png`),
      kind: 'id-raster',
      level,
      width: 4096,
      height: 2048,
      encoding: 'rgb24',
      gpuBytes: 4096 * 2048 * 2,
    };
    for (const metric of metrics) {
      derivedAssets[`inverse-${metric}-${level}.bin`] = {
        ...identity(`inverse-${metric}-${level}.bin`),
        kind: 'inverse-field',
        metric,
        level,
        width: level === 'country' ? 512 : 1024,
        height: level === 'country' ? 256 : 512,
        encoding: 'int16-meshopt',
        stepLongitude: 0.001,
        stepS: 0.00001,
        gpuBytes: (level === 'country' ? 512 * 256 : 1024 * 512) * 8 + 20,
      };
      acceptance[`${metric}-${level}`] = {
        triangleOrientation: true,
        medianAreaError: 0.01,
        p90AreaError: 0.03,
        roundTripP999Degrees: 0.01,
        roundTripMaxDegrees: 0.04,
        totalAreaRelativeError: 1e-10,
        quantizationMaxDegrees: 0.005,
        iterations: 2,
        unitsChecked: 10,
        algorithm: 'gsm2018-fast-flow',
      };
    }
  }
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
    formatVersion: 1,
    year: 2020,
    grid: { projection: 'cylindrical-equal-area', width: 2048, height: 1024 },
    sources: metrics.map((metric) => ({
      id: metric,
      name: metric,
      url: 'https://example.com/source',
      license: 'CC BY 4.0',
      year: 2020,
    })),
    sourceAssets: Object.fromEntries(
      [...metrics, 'admin1', 'chn', 'default'].map((key) => [
        key,
        {
          key,
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
    acceptance,
    boundaryAdjustments: [],
    nameCoverage: {
      admin1: 10,
      chinese: 8,
      fraction: 0.8,
      naturalEarthAdmin1: 9,
      wholeCountryFallback: 1,
    },
    unassigned: Object.fromEntries(metrics.map((metric) => [metric, 0.001])),
    aggregation: Object.fromEntries(
      metrics.map((metric) => [
        metric,
        {
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

  it('accepts the complete synthetic Reshaped Earth contract while isolating unaccepted candidates', () => {
    const manifest = reshapedManifestFixture();
    expect(
      DATA_MANIFESTS.some((candidate) => candidate.id === 'reshaped-earth'),
    ).toBe(false);
    expect(manifest).toMatchObject({
      formatVersion: 1,
      year: 2020,
      grid: { projection: 'cylindrical-equal-area', width: 2048, height: 1024 },
    });
    const material = structuredClone(manifest);
    material.materialMeshes = {
      country: { width: 2048, height: 1024 },
      admin1: { width: 4096, height: 2048 },
    };
    expect(dataManifestSchema.safeParse(material).success).toBe(true);
    material.materialMeshes.admin1.height = 1024;
    expect(dataManifestSchema.safeParse(material).success).toBe(false);
    expect(Object.keys(manifest.derivedAssets)).toHaveLength(13);
    expect(Object.keys(manifest.acceptance)).toHaveLength(8);
    expect(manifest.unassigned.population).toBeLessThan(0.005);
    for (const result of Object.values(manifest.acceptance)) {
      expect(result.triangleOrientation).toBe(true);
      expect(result.medianAreaError).toBeLessThan(0.05);
      expect(result.p90AreaError).toBeLessThan(0.15);
      expect(result.roundTripP999Degrees).toBeLessThan(0.05);
      expect(result.roundTripMaxDegrees).toBeLessThan(0.5);
      expect(result.quantizationMaxDegrees).toBeLessThan(0.01);
      expect(result.totalAreaRelativeError).toBeLessThan(1e-6);
      expect(result.unitsChecked).toBeGreaterThan(0);
    }
  });

  it('rejects missing maps, wrong-level dimensions and vector placeholder fields', () => {
    const manifest = reshapedManifestFixture();
    const missingMap = structuredClone(manifest);
    delete missingMap.derivedAssets['inverse-co2-admin1.bin'];
    const missingAcceptance = structuredClone(manifest);
    delete missingAcceptance.acceptance['lights-country'];
    const wrongDimensions = structuredClone(manifest);
    const inverse = wrongDimensions.derivedAssets['inverse-gdp-country.bin'];
    if (!inverse || inverse.kind !== 'inverse-field')
      throw new Error('Wrong inverse asset type');
    inverse.width = 1024;
    const vectorPlaceholder = structuredClone(manifest);
    Object.assign(vectorPlaceholder.derivedAssets['units.json']!, {
      vertices: 1,
      triangles: 1,
    });
    for (const invalid of [
      missingMap,
      missingAcceptance,
      wrongDimensions,
      vectorPlaceholder,
    ])
      expect(dataManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects cartogram acceptance outside the agreed thresholds', () => {
    const manifest = reshapedManifestFixture();
    for (const [field, value] of Object.entries({
      medianAreaError: 0.05,
      p90AreaError: 0.15,
      roundTripP999Degrees: 0.05,
      roundTripMaxDegrees: 0.5,
      quantizationMaxDegrees: 0.01,
      totalAreaRelativeError: 1e-6,
      unitsChecked: 0,
    })) {
      const invalid = structuredClone(manifest);
      Object.assign(invalid.acceptance['population-country']!, {
        [field]: value,
      });
      expect(dataManifestSchema.safeParse(invalid).success, field).toBe(false);
    }
  });

  it('accepts MRE2 roots at 64 or 128 and validates counts, padding and continuity evidence', () => {
    for (const width of [64, 128]) {
      const manifest = reshapedManifestFixture();
      for (const [name, asset] of Object.entries(manifest.derivedAssets)) {
        if (asset.kind !== 'inverse-field') continue;
        Object.assign(asset, {
          encoding: 'adaptive-quadtree-int16',
          width,
          height: width / 2,
          treeNodes: (width * width) / 2 + 4,
          leafCount: (width * width) / 2 + 3,
          maxDepth: 8,
        });
        asset.gpuBytes = inverseTextureBytesFromDescriptor(asset);
        manifest.acceptance[
          `${asset.metric}-${asset.level}`
        ]!.edgeJumpMaxDegrees = 0.00001;
        const malformed = structuredClone(manifest);
        const wrong = malformed.derivedAssets[name]!;
        if (wrong.kind !== 'inverse-field')
          throw new Error('Wrong inverse type');
        wrong.treeNodes! += 1;
        expect(dataManifestSchema.safeParse(malformed).success).toBe(false);
      }
      expect(dataManifestSchema.safeParse(manifest).success).toBe(true);
      const latitude = structuredClone(manifest);
      for (const asset of Object.values(latitude.derivedAssets)) {
        if (asset.kind !== 'inverse-field') continue;
        delete asset.stepS;
        asset.verticalCoordinate = 'latitude';
        asset.stepLatitude = 0.001;
      }
      expect(dataManifestSchema.safeParse(latitude).success).toBe(true);
      const mixedUnits = structuredClone(latitude);
      const mixedField =
        mixedUnits.derivedAssets['inverse-population-country.bin']!;
      if (mixedField.kind !== 'inverse-field')
        throw new Error('Wrong inverse type');
      mixedField.stepS = 0.0001;
      expect(dataManifestSchema.safeParse(mixedUnits).success).toBe(false);
      delete mixedField.stepS;
      delete mixedField.stepLatitude;
      expect(dataManifestSchema.safeParse(mixedUnits).success).toBe(false);
      const wrongGpu = structuredClone(manifest);
      wrongGpu.derivedAssets['inverse-population-country.bin']!.gpuBytes -= 1;
      expect(dataManifestSchema.safeParse(wrongGpu).success).toBe(false);
      const missingEdges = structuredClone(manifest);
      delete missingEdges.acceptance['population-country']!.edgeJumpMaxDegrees;
      expect(dataManifestSchema.safeParse(missingEdges).success).toBe(false);
      const discontinuous = structuredClone(manifest);
      discontinuous.acceptance['population-country']!.edgeJumpMaxDegrees = 0.01;
      expect(dataManifestSchema.safeParse(discontinuous).success).toBe(false);
    }
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
