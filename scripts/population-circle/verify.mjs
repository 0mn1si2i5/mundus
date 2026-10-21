import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SOURCES } from '../reshaped-earth/sources.mjs';
import { decodePngRgb } from '../../src/features/reshaped/pngCore.mjs';
import {
  populationProfile,
  populationWithin,
  prepareCells,
  radiusForShare,
} from '../../src/features/circle/circleProfile.mjs';

export const POPULATION_CIRCLE_MANIFEST =
  'src/data/manifests/population-circle.json';
/** Raw PNG budget; Pages serves images without further compression. */
export const POPULATION_CIRCLE_MAX_BYTES = 1_200_000;

/**
 * Fail closed on the published grid: identity, pinned source, exact total,
 * and the smallest half circle reproduced with the browser's arithmetic.
 */
export async function verifyPopulationCircle(
  manifestPath = POPULATION_CIRCLE_MANIFEST,
) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.id, 'population-circle');
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.year, 2020);
  assert.equal(manifest.licenseName, 'CC BY 4.0');
  const source = SOURCES.population;
  assert.equal(manifest.source.sha256, source.sha256, 'GHS-POP pin changed');
  assert.equal(manifest.source.bytes, source.bytes);
  assert.equal(manifest.source.url, source.url);
  const { grid, totals, smallestHalfCircle, derivedAsset } = manifest;
  assert.deepEqual(
    [grid.width, grid.height, grid.cellDegrees, grid.west, grid.north],
    [1440, 720, 0.25, -180, 90],
  );
  assert.ok([1, 10, 100].includes(grid.unit), 'Unexpected count unit');
  const bytes = await readFile(derivedAsset.path);
  assert.equal(bytes.byteLength, derivedAsset.bytes);
  assert.ok(
    bytes.byteLength <= POPULATION_CIRCLE_MAX_BYTES,
    `Population grid is ${bytes.byteLength} bytes`,
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    derivedAsset.sha256,
    'Population grid hash mismatch',
  );
  const decoded = await decodePngRgb(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  assert.equal(decoded.width, grid.width);
  assert.equal(decoded.height, grid.height);
  const cells = prepareCells(decoded.ids, grid.width, grid.height, grid.unit);
  assert.equal(cells.total, totals.published, 'Published total mismatch');
  assert.equal(cells.count, totals.populatedCells);
  // Rounding each cell to the unit moves the total by at most half a unit
  // per populated cell.
  assert.ok(
    Math.abs(totals.published - totals.source) <= (cells.count * grid.unit) / 2,
    'Rounded total drifts from the source total',
  );
  assert.ok(Math.abs(totals.source - 7.8e9) / 7.8e9 <= 0.02);
  const profile = populationProfile(
    cells,
    smallestHalfCircle.latitude,
    smallestHalfCircle.longitude,
  );
  const radiusKm = radiusForShare(profile, 0.5);
  assert.equal(Math.round(radiusKm), smallestHalfCircle.radiusKm);
  assert.equal(
    Math.round(populationWithin(profile, radiusKm)),
    smallestHalfCircle.population,
  );
  return { bytes: bytes.byteLength, cells: cells.count };
}
