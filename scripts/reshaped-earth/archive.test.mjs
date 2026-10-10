import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectArchive, extractArchive } from './archive.mjs';
const run = promisify(execFile);

test('ZIP inspection bounds extraction and CRC-verified cache resumes by identity', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'mundus-archive-'));
  t.after(() => run('/usr/bin/trash', [cacheDir]));
  await writeFile(join(cacheDir, '2020.nc'), 'tiny reviewed data');
  const path = join(cacheDir, 'source.zip');
  await run('zip', ['-q', path, '2020.nc'], { cwd: cacheDir });
  const inspected = await inspectArchive(path);
  assert.equal(inspected.extractedBytes, 18);
  const args = { path, key: 'co2', cacheDir, sha256: 'a'.repeat(64) };
  await assert.rejects(extractArchive({ ...args, maxBytes: 1 }), /S3/);
  const extracted = await extractArchive(args);
  assert.equal(
    await readFile(join(extracted.directory, '2020.nc'), 'utf8'),
    'tiny reviewed data',
  );
  assert.deepEqual(await extractArchive(args), extracted);
  await writeFile(join(extracted.directory, '2020.nc'), 'truncated');
  await assert.rejects(extractArchive(args), /size mismatch/);
});

test('ZIP traversal and symlink entries fail before extraction', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'mundus-archive-'));
  t.after(() => run('/usr/bin/trash', [cacheDir]));
  await writeFile(join(cacheDir, 'abc.nc'), 'data');
  const path = join(cacheDir, 'source.zip');
  await run('zip', ['-q', path, 'abc.nc'], { cwd: cacheDir });
  const original = await readFile(path);
  const directory = original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const traversal = Buffer.from(original);
  traversal.write('../bad', directory + 46);
  await writeFile(join(cacheDir, 'traversal.zip'), traversal);
  await assert.rejects(
    inspectArchive(join(cacheDir, 'traversal.zip')),
    /Unsafe/,
  );
  const symlink = Buffer.from(original);
  symlink.writeUInt32LE(0xa1ff0000, directory + 38);
  await writeFile(join(cacheDir, 'symlink.zip'), symlink);
  await assert.rejects(
    inspectArchive(join(cacheDir, 'symlink.zip')),
    /Symlink/,
  );
});
