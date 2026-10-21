import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { decodePngRgb } from '../../src/features/reshaped/pngCore.mjs';
import { SOURCE } from './source.mjs';
import {
  ASSET_PATH,
  CLASS_COUNT,
  MANIFEST_PATH,
  landShares,
  sha256,
} from './build.mjs';

/** Fail-closed check of the Climate Twins manifest, source pin and raster. */
export async function verifyKoppenGeiger() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.licenseName, 'CC BY 4.0');
  for (const [field, expected] of Object.entries({
    fileName: SOURCE.fileName,
    distributionUrl: SOURCE.distributionUrl,
    sha256: SOURCE.sha256,
    rawBytes: SOURCE.bytes,
  }))
    assert.equal(
      manifest.sourceAsset[field],
      expected,
      `Köppen-Geiger source ${field} differs from its pin`,
    );
  assert.equal(manifest.retrievedAt, SOURCE.retrievedAt);
  const asset = manifest.derivedAsset;
  assert.equal(asset.path, ASSET_PATH);
  const bytes = await readFile(ASSET_PATH);
  assert.equal(sha256(bytes), asset.sha256, 'Köppen-Geiger raster hash');
  assert.equal(bytes.byteLength, asset.rawBytes);
  assert.equal(
    gzipSync(bytes, { level: 9, mtime: 0 }).byteLength,
    asset.gzipBytes,
  );
  assert.ok(asset.gzipBytes <= 900 * 1024, 'Köppen-Geiger raster budget');
  const raster = await decodePngRgb(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  assert.equal(raster.width, manifest.grid.width);
  assert.equal(raster.height, manifest.grid.height);
  const classes = new Uint8Array(raster.ids.length);
  for (let i = 0; i < classes.length; i += 1) {
    assert.ok(raster.ids[i] <= CLASS_COUNT, 'Köppen-Geiger class range');
    classes[i] = raster.ids[i];
  }
  assert.deepEqual(
    landShares({ grid: manifest.grid, classes }),
    manifest.landShare,
    'Köppen-Geiger land shares must match the raster',
  );
  return asset;
}
