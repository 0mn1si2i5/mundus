import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEVELS } from './config.mjs';
import {
  computationIdentity,
  saveComputation,
  loadComputation,
} from './computation-cache.mjs';
import { regionGrid, buildCityReach } from '../build-city-reach.mjs';

test('complete computation cache resumes all levels after a name gate, while partial and altered bytes fail safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-reach-computed-'));
  const grid = {
    width: 2,
    height: 1,
    west: 0,
    north: 1 / 30,
    step: 1 / 30,
    wrapLongitude: false,
  };
  const capture = {
    complete: true,
    grid,
    tiles: [
      {
        id: '0_0',
        url: 'https://example.com/tile',
        sha256: 'a'.repeat(64),
        fineLand: { sha256: 'b'.repeat(64) },
      },
    ],
  };
  try {
    const identity = await computationIdentity(grid, capture);
    assert.notEqual(await computationIdentity(grid, capture, true), identity);
    assert.notEqual(
      await computationIdentity(grid, {
        ...capture,
        tiles: [{ ...capture.tiles[0], sha256: 'c'.repeat(64) }],
      }),
      identity,
    );
    await assert.rejects(
      computationIdentity(grid, { ...capture, complete: false }),
      /Complete matching/,
    );
    assert.equal(await loadComputation(directory, identity), null);
    const computation = {
      grid,
      cities: [
        { id: 12, ownerIndex: 1, sourceName: 'Review later', sourceCells: [0] },
      ],
      thresholds: new Map([
        [12, { status: 'root', threshold: null, parentId: null }],
      ]),
      requiredIds: new Set([12]),
      levelOwners: new Map(
        LEVELS.map((level) => [level, new Uint16Array([1, 0])]),
      ),
      disputed: new Uint8Array([0, 1]),
      density: new Uint8Array([0, 255]),
      mapCapture: capture,
      waterwaysAudit: { connections: [], reviewed: false },
      report: { cityCount: 1 },
    };
    const path = await saveComputation(directory, identity, computation);
    const loaded = await loadComputation(directory, identity);
    assert.equal(loaded.reusedCache, true);
    assert.deepEqual(loaded.requiredIds, computation.requiredIds);
    assert.deepEqual(loaded.thresholds, computation.thresholds);
    assert.deepEqual(loaded.levelOwners, computation.levelOwners);
    assert.deepEqual(loaded.density, computation.density);
    assert.equal(loaded.cities[0].sourceName, 'Review later');
    assert.equal(loaded.cities[0].sourceCells, undefined);
    await writeFile(join(path, 'owners-4.u16le'), Buffer.from([2, 0, 0, 0]));
    await assert.rejects(
      loadComputation(directory, identity),
      /SHA-256 mismatch: owners-4/,
    );
    await rm(join(path, 'complete.json'));
    assert.equal(await loadComputation(directory, identity), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('exported builder cannot publish regional grids and region parsing refuses extra coordinates', async () => {
  assert.throws(() => regionGrid('-1,50,1,52,90'), /exactly four/);
  await assert.rejects(
    buildCityReach({ grid: regionGrid('-1,50,1,52') }),
    /benchmark-only/,
  );
});
