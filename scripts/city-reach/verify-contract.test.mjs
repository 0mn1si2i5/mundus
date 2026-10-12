import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveAndSummarizeCapture,
  validateSourceSummary,
} from './source-capture.mjs';
import { MAP_COVERAGE, tileRequests } from './config.mjs';
import { waterwaySourceDigest } from './fine-waterways.mjs';
import { validateRequiredNames, validateSourceCapture } from './verify.mjs';

test('publication verification rejects an unreviewed or stale narrow-waterway capture', async () => {
  const grid = {
    width: 1,
    height: 1,
    west: 0,
    north: 1 / 30,
    step: 1 / 30,
    wrapLongitude: false,
  };
  const request = tileRequests(grid)[0];
  const capture = {
    schemaVersion: 1,
    map: {
      schemaVersion: 1,
      complete: true,
      coverageId: MAP_COVERAGE,
      grid,
      tiles: [
        {
          ...request,
          width: 4,
          height: 4,
          hashKind: 'decoded-float32-le',
          sha256: 'a'.repeat(64),
          responseSha256: 'b'.repeat(64),
          fineLand: {
            sha256: 'c'.repeat(64),
            rawBytes: 2,
            encoding:
              'row-major packed bits, bit 0 first, 1=valid nonwater pixel',
          },
        },
      ],
    },
  };
  capture.narrowWaterwaysAudit = {
    schemaVersion: 1,
    reviewed: true,
    connections: [],
    sourceDigest: waterwaySourceDigest(grid, capture.map),
  };
  assert.equal(validateSourceCapture(capture, grid), capture);
  const unreviewed = structuredClone(capture);
  unreviewed.narrowWaterwaysAudit.reviewed = false;
  assert.throws(
    () => validateSourceCapture(unreviewed, grid),
    /narrow-waterway review/,
  );
  const changed = structuredClone(capture);
  changed.map.tiles[0].fineLand.sha256 = 'd'.repeat(64);
  assert.throws(
    () => validateSourceCapture(changed, grid),
    /different sources/,
  );
  const incomplete = structuredClone(capture);
  incomplete.map.complete = false;
  assert.throws(() => validateSourceCapture(incomplete, grid), /incomplete/);
  const shifted = structuredClone(capture);
  shifted.map.tiles[0].bounds.west = -1;
  assert.throws(() => validateSourceCapture(shifted, grid), /tile identity/);
  const directory = await mkdtemp(join(tmpdir(), 'mundus-source-capture-'));
  try {
    const { summary, archivePath } = await archiveAndSummarizeCapture(
      capture,
      grid,
      new Set([2, 1]),
      directory,
    );
    assert.deepEqual(summary.requiredCityIds, [1, 2]);
    assert.equal(validateSourceSummary(summary, grid), summary);
    const invalidReview = structuredClone(summary);
    invalidReview.narrowWaterwaysAudit.reviewed = false;
    assert.throws(
      () => validateSourceSummary(invalidReview, grid),
      /reviewed identity/,
    );
    const incompleteSummary = structuredClone(summary);
    incompleteSummary.map.tileCount = 0;
    assert.throws(
      () => validateSourceSummary(incompleteSummary, grid),
      /source summary/,
    );
    const invalidRequiredIds = structuredClone(summary);
    invalidRequiredIds.requiredCityIds = [2, 2];
    assert.throws(
      () => validateSourceSummary(invalidRequiredIds, grid),
      /source summary/,
    );
    await writeFile(archivePath, '{}');
    await assert.rejects(
      archiveAndSummarizeCapture(capture, grid, new Set([1]), directory),
      /Archived.*SHA-256 mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('published required names keep the two-override exception and reject missing country names', () => {
  const first = {
    id: 1,
    name: { en: 'A', zh: '甲' },
    country: { en: 'Country', zh: '国家' },
    nameMatchType: 'override',
  };
  const second = { ...structuredClone(first), id: 2, nameMatchType: 'exact' };
  const asset = { cities: [first, second] };
  const required = new Set([1, 2]);
  assert.throws(
    () => validateRequiredNames(asset, required),
    /Chinese name conflict/,
  );
  second.nameMatchType = 'override';
  assert.doesNotThrow(() => validateRequiredNames(asset, required));
  second.country.zh = null;
  assert.throws(
    () => validateRequiredNames(asset, required),
    /lacks reviewed names/,
  );
});

test('published names allow missing Chinese names and check countries and duplicates outside the required subset', () => {
  const first = {
    id: 1,
    name: { en: 'Fallback', zh: null },
    country: { en: 'Country', zh: '国家' },
    nameMatchType: 'none',
  };
  const second = { ...structuredClone(first), id: 2 };
  const asset = { cities: [first, second] };
  const required = new Set([1]);
  assert.doesNotThrow(() => validateRequiredNames(asset, required));
  first.name.en = '';
  assert.throws(
    () => validateRequiredNames(asset, required),
    /lacks reviewed names/,
  );
  first.name.en = 'Fallback';
  second.country.zh = null;
  assert.throws(
    () => validateRequiredNames(asset, required),
    /lacks reviewed names/,
  );
  second.country.zh = '国家';
  first.name.zh = second.name.zh = '同名';
  first.nameMatchType = second.nameMatchType = 'exact';
  assert.throws(
    () => validateRequiredNames(asset, required),
    /Chinese name conflict/,
  );
});
