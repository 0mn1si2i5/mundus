import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  mapRequestToFile,
  startLiteralMountServer,
} from './serve-literal-mount.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mundus-literal-mount-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<h1>Mundus</h1>');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("Mundus");');
  return root;
}

test('maps only decoded paths contained by the literal mount', () => {
  assert.equal(mapRequestToFile('/mundus/assets/app.js'), 'assets/app.js');
  assert.equal(mapRequestToFile('/mundus/atlas/place'), 'index.html');
  assert.equal(mapRequestToFile('/mundus/'), 'index.html');
  assert.equal(mapRequestToFile('/other/assets/app.js'), null);
  assert.equal(mapRequestToFile('/mundus/%2e%2e/secret.txt'), null);
  assert.equal(mapRequestToFile('/mundus/assets%2f..%2f..%2fsecret.txt'), null);
  assert.equal(mapRequestToFile('/mundus/missing.js'), 'missing.js');
});

test('serves unchanged content with content types and SPA fallback', async (t) => {
  const distDir = await fixture();
  t.after(() => rm(distDir, { recursive: true, force: true }));

  const server = await startLiteralMountServer({ distDir, port: 0 });
  t.after(() => server.close());

  const script = await fetch(`${server.url}assets/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /^text\/javascript/u);
  assert.equal(await script.text(), 'console.log("Mundus");');

  const spa = await fetch(`${server.url}atlas/place`);
  assert.equal(spa.status, 200);
  assert.match(spa.headers.get('content-type'), /^text\/html/u);
  assert.equal(await spa.text(), '<h1>Mundus</h1>');

  const missingAsset = await fetch(`${server.url}missing.js`);
  assert.equal(missingAsset.status, 404);

  const outside = await fetch(
    `http://127.0.0.1:${server.port}/outside/index.html`,
  );
  assert.equal(outside.status, 404);
});

test('does not follow a symlink outside dist', async (t) => {
  const distDir = await fixture();
  const outsideDir = await mkdtemp(join(tmpdir(), 'mundus-literal-outside-'));
  await writeFile(join(outsideDir, 'secret.txt'), 'secret');
  await symlink(outsideDir, join(distDir, 'linked'));
  t.after(() => rm(distDir, { recursive: true, force: true }));
  t.after(() => rm(outsideDir, { recursive: true, force: true }));

  const server = await startLiteralMountServer({ distDir, port: 0 });
  t.after(() => server.close());

  const response = await fetch(`${server.url}linked/secret.txt`);
  assert.equal(response.status, 404);
});

test('command prints its literal URL and shuts down on SIGTERM', async (t) => {
  const distDir = await fixture();
  t.after(() => rm(distDir, { recursive: true, force: true }));

  const child = spawn(process.execPath, ['scripts/serve-literal-mount.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      MUNDUS_LITERAL_DIST_DIR: distDir,
      MUNDUS_LITERAL_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  const output = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', (chunk) => resolve(chunk.toString()));
  });
  assert.match(
    output,
    /^Serving unchanged dist at http:\/\/127\.0\.0\.1:\d+\/mundus\/\n$/u,
  );

  child.kill('SIGTERM');
  const exit = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(exit, 0);
});
