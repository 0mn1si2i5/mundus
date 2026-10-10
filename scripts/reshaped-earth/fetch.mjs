import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, rename, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { SOURCES } from './sources.mjs';

export const CACHE_DIR = resolve(
  process.env.MUNDUS_DATA_CACHE ?? join(homedir(), '.cache/mundus-data'),
  'reshaped-earth',
);
const run = promisify(execFile);
if (CACHE_DIR.startsWith(resolve('.') + '/'))
  throw new Error('Raw data cache must be outside the worktree');

export async function identity(path) {
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    sha256.update(chunk);
    md5.update(chunk);
  }
  return { sha256: sha256.digest('hex'), md5: md5.digest('hex'), bytes };
}

export function verifyIdentity(source, captured, capture = false) {
  if (source.bytes !== undefined && captured.bytes !== source.bytes)
    throw new Error(
      `S1: ${source.fileName}: expected ${source.bytes} bytes, got ${captured.bytes}`,
    );
  if (source.md5 && captured.md5 !== source.md5)
    throw new Error(`${source.fileName}: upstream MD5 mismatch`);
  if (!capture && !source.sha256)
    throw new Error(
      `${source.fileName}: SHA-256 not pinned; run --capture and review`,
    );
  if (source.sha256 && captured.sha256 !== source.sha256)
    throw new Error(`${source.fileName}: SHA-256 mismatch`);
  return captured;
}

export async function fetchSource(key, { capture = false } = {}) {
  const source = SOURCES[key];
  if (!source) throw new Error(`Unknown source ${key}`);
  if (!capture && !source.sha256) throw new Error(`${key}: unpinned source`);
  await mkdir(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, source.fileName);
  const exists = await stat(path).catch(() => null);
  if (!exists) {
    console.log(`Downloading ${key}: ${source.fileName}`);
    const partial = `${path}.partial`;
    const partialSize = (await stat(partial).catch(() => null))?.size ?? 0;
    if (partialSize > (source.bytes ?? Infinity))
      throw new Error(`${key}: partial file exceeds reviewed source size`);
    // curl honours the host's proxy configuration. No automatic retry loop:
    // an unavailable source is reported for a deliberate, bounded retry.
    await run(
      'curl',
      [
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--max-time',
        '900',
        '--max-filesize',
        String(source.bytes ?? 100_000_000),
        ...(partialSize && source.supportsResume !== false
          ? ['--continue-at', '-']
          : []),
        '--output',
        partial,
        source.downloadUrl ?? source.url,
      ],
      { maxBuffer: 65536 },
    );
    verifyIdentity(source, await identity(partial), capture);
    await rename(partial, path);
  }
  const captured = verifyIdentity(source, await identity(path), capture);
  return {
    key,
    path,
    ...captured,
    url: source.url,
    fileName: source.fileName,
    licence: source.licence,
    version: source.version,
    year: source.year,
    retrievedAt: new Date().toISOString(),
  };
}

export async function captureSources(keys = Object.keys(SOURCES)) {
  const sources = [];
  // Sequential streaming keeps the resource envelope independent of file size.
  for (const key of keys) {
    const captured = await fetchSource(key, { capture: true });
    sources.push(captured);
    console.log(JSON.stringify(captured));
  }
  await writeFile(
    join(CACHE_DIR, 'capture.json'),
    `${JSON.stringify({ sources }, null, 2)}\n`,
  );
  return sources;
}
