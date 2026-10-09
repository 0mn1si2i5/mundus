import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { DATA_MANIFESTS, dataManifestSchema } from './registry';

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
    expect(manifest?.derivedAssets?.['110m']?.gpuBytes).toBeLessThanOrEqual(
      8 * 1024 * 1024,
    );
    expect(manifest?.derivedAssets?.['50m']?.gpuBytes).toBeLessThanOrEqual(
      24 * 1024 * 1024,
    );
    expect(manifest?.derivedAssets?.['50m']?.gzipBytes).toBeLessThanOrEqual(
      1.5 * 1024 * 1024,
    );
    expect(
      manifest?.derivedAssets?.['110m']?.droppedOutsideAreaFraction,
    ).toBeLessThan(0.0001);
    expect(
      manifest?.derivedAssets?.['50m']?.droppedOutsideAreaFraction,
    ).toBeLessThan(0.0001);
    expect(manifest?.derivedAssets?.['50m']?.runtimeGpuBytes).toBe(
      manifest?.derivedAssets?.['50m']?.gpuBytes,
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
        'fe4bc705981439cfbab39130594213641b0ff5a9e94afb552d090b804419f1d1',
      recordCount: 239,
      rawBytes: 22654,
      gzipBytes: 5150,
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
        '97582dda9203e5e90fe546fee9a8645c81b85306c67c796ea74fd3337e434767',
      recordCount: 1106,
      rawBytes: 687308,
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
