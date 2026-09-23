import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { DATA_MANIFESTS, dataManifestSchema } from './registry';

describe('data registry', () => {
  it('contains valid manifests with unique ids', () => {
    const ids = DATA_MANIFESTS.map((manifest) => manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'natural-earth-countries-110m',
      'natural-earth-vector-globe',
      'undp-hdr-2025-development',
      'geonames-major-cities',
      'surnames-by-country',
      'country-label-anchors',
      'surname-label-slots',
      'surname-coverage',
    ]);
    expect(
      DATA_MANIFESTS.every(
        (manifest) => dataManifestSchema.safeParse(manifest).success,
      ),
    ).toBe(true);
  });

  it('pins both vector resolutions and their transfer and GPU budgets', () => {
    const manifest = DATA_MANIFESTS.find(
      (candidate) => candidate.id === 'natural-earth-vector-globe',
    );
    expect(manifest?.sourceAssets).toMatchObject({
      '110m': {
        sha256:
          '2516c915867c7baf18ddec727aec46c315541a07cfb3d79a6559b05d5e94eee8',
      },
      '50m': {
        sha256:
          '04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394',
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
    expect(
      dataManifestSchema.safeParse(
        DATA_MANIFESTS.find(
          (candidate) => candidate.id === 'undp-hdr-2025-development',
        ),
      ).success,
    ).toBe(true);
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
        'd2ca10f3590387954ef832aeb28fe598e5dd70ce26de7fb5cfafaa22b039e246',
      recordCount: 288,
      rawBytes: 93515,
      gzipBytes: 7226,
      staticDecodedBytesEstimate: 374060,
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
        '8719111a9732ce745b5e90137ac1cb638a3fe76820a4912c8dfa9417bac4983f',
      recordCount: 240,
      rawBytes: 22681,
      gzipBytes: 5457,
      sourceAssets: {
        '50m': {
          sha256:
            '04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394',
        },
        '110m': {
          sha256:
            '2516c915867c7baf18ddec727aec46c315541a07cfb3d79a6559b05d5e94eee8',
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
        '1630b729e896f67a91e069e3aec4bcddab796188db9e98aa8bdbf34932a5a181',
      recordCount: 5264,
      rawBytes: 1912492,
      sourceAssets: {
        '50m': {
          sha256:
            '04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394',
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
        '8466509b82b8812c1082297e05bea57661fc97a6408508e7450e7fabdd60eabf',
      recordCount: 240,
      rawBytes: 26006,
    });
  });
});
