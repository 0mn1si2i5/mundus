import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('patch-only rebuild rejects unpinned geometry before touching published assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-patch-source-'));
  const paths = [
    'src/data/manifests/reshaped-earth.json',
    'src/data/generated/reshaped-earth/ids-patches.png',
    'src/data/generated/reshaped-earth/ids-patches.json',
  ];
  const before = await Promise.all(paths.map((path) => readFile(path)));
  try {
    await writeFile(
      join(directory, 'chn.geojson'),
      '{"type":"FeatureCollection","features":[]}',
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve('scripts/rebuild-reshaped-patches.mjs'),
        '--source-dir',
        directory,
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Source identity mismatch: chn/u);
    for (const [index, path] of paths.entries()) {
      assert.deepEqual(await readFile(path), before[index]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
