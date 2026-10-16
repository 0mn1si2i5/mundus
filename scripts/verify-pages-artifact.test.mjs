import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const verifier = resolve('scripts/verify-pages-artifact.mjs');
const generatedAssets = {
  '110m': resolve('src/data/generated/natural-earth-vector-globe-110m.mvg'),
  '50m': resolve('src/data/generated/natural-earth-vector-globe-50m.mvg'),
};

async function createArtifact({
  javascript = 'new URL("natural-earth-vector-globe-110m-test.mvg",import.meta.url);' +
    'new URL("natural-earth-vector-globe-50m-test.mvg",import.meta.url);',
  stylesheet = '',
  notices = '## react@19\n\nMIT license text\n',
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mundus-pages-'));
  await mkdir(join(root, 'assets'));
  await Promise.all([
    writeFile(
      join(root, 'index.html'),
      '<title>Mundus · 交互式三维地球实验室</title><div id="root"></div><script src="./assets/app.js"></script><link href="./assets/app.css" rel="stylesheet">',
    ),
    writeFile(
      join(root, 'favicon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    ),
    writeFile(join(root, 'LICENSE'), 'MIT'),
    writeFile(join(root, 'THIRD_PARTY_LICENSES.md'), '# Third-party licenses'),
    writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), notices),
    writeFile(join(root, 'assets/app.js'), javascript),
    writeFile(join(root, 'assets/app.css'), stylesheet),
    copyFile(
      generatedAssets['110m'],
      join(root, 'assets/natural-earth-vector-globe-110m-test.mvg'),
    ),
    copyFile(
      generatedAssets['50m'],
      join(root, 'assets/natural-earth-vector-globe-50m-test.mvg'),
    ),
  ]);
  return root;
}

async function addPreviews(root, manifestOverride = {}) {
  await mkdir(join(root, 'previews'));
  const manifest = {
    schemaVersion: 1,
    source: { repository: '0mn1si2i5/mundus', commit: null },
    modes: [
      {
        id: 'antipodes',
        href: '../?v=2&mode=antipodes',
        title: { zh: '地球另一端', en: 'Other Side' },
        question: { zh: '问题', en: 'Question' },
        image: {
          width: 1600,
          height: 900,
          src: { zh: 'antipodes-zh.webp', en: 'antipodes-en.webp' },
          alt: { zh: '截图', en: 'Screenshot' },
        },
      },
    ],
    ...manifestOverride,
  };
  await Promise.all([
    writeFile(join(root, 'previews/manifest.json'), JSON.stringify(manifest)),
    writeFile(join(root, 'previews/antipodes-zh.webp'), 'RIFF0000WEBP'),
    writeFile(join(root, 'previews/antipodes-en.webp'), 'RIFF0000WEBP'),
  ]);
}

async function verifyFailure(root, expectedMessage, extraArgs = []) {
  await assert.rejects(
    execFileAsync(process.execPath, [verifier, root, ...extraArgs]),
    (error) => error.stderr.includes(expectedMessage),
  );
}

test('rejects root-relative references in JavaScript', async () => {
  const root = await createArtifact({
    javascript:
      "fetch('/data.json');" +
      'new URL("natural-earth-vector-globe-110m-test.mvg",import.meta.url);' +
      'new URL("natural-earth-vector-globe-50m-test.mvg",import.meta.url);',
  });
  await verifyFailure(root, 'Root-relative asset breaks project Pages');
});

test('rejects root-relative references in CSS', async () => {
  const root = await createArtifact({
    stylesheet: "body{background:url('/image.png')}",
  });
  await verifyFailure(root, 'Root-relative asset breaks project Pages');
});

test('rejects an empty bundled notices file', async () => {
  const root = await createArtifact({ notices: '' });
  await verifyFailure(root, 'Bundled dependency notices are empty');
});

test('rejects a missing vector globe resolution', async () => {
  const root = await createArtifact();
  await import('node:fs/promises').then(({ rm }) =>
    rm(join(root, 'assets/natural-earth-vector-globe-50m-test.mvg')),
  );
  await verifyFailure(root, 'Broken asset reference in assets/app.js');
});

test('rejects a missing referenced vector file despite an unreferenced valid copy', async () => {
  const root = await createArtifact({
    javascript:
      'new URL("natural-earth-vector-globe-110m-missing.mvg",import.meta.url);' +
      'new URL("natural-earth-vector-globe-50m-test.mvg",import.meta.url);',
  });
  await verifyFailure(root, 'Broken asset reference in assets/app.js');
});

test('rejects ambiguous vector references for one resolution', async () => {
  const root = await createArtifact({
    javascript:
      'new URL("natural-earth-vector-globe-110m-test.mvg",import.meta.url);' +
      'new URL("natural-earth-vector-globe-110m-copy.mvg",import.meta.url);' +
      'new URL("natural-earth-vector-globe-50m-test.mvg",import.meta.url);',
  });
  await copyFile(
    generatedAssets['110m'],
    join(root, 'assets/natural-earth-vector-globe-110m-copy.mvg'),
  );
  await verifyFailure(root, 'Expected exactly one 110m vector globe reference');
});

test('rejects valid vector globe files swapped between emitted resolution names', async () => {
  const root = await createArtifact();
  await Promise.all([
    copyFile(
      generatedAssets['50m'],
      join(root, 'assets/natural-earth-vector-globe-110m-test.mvg'),
    ),
    copyFile(
      generatedAssets['110m'],
      join(root, 'assets/natural-earth-vector-globe-50m-test.mvg'),
    ),
  ]);
  await verifyFailure(root, '110m vector globe identity mismatch');
});

test('rejects a one-byte alteration to an emitted vector globe file', async () => {
  const root = await createArtifact();
  const path = join(root, 'assets/natural-earth-vector-globe-50m-test.mvg');
  const bytes = await readFile(path);
  bytes[bytes.byteLength - 1] ^= 1;
  await writeFile(path, bytes);
  await verifyFailure(root, '50m vector globe identity mismatch');
});

test('accepts complete portfolio previews when they are required', async () => {
  const root = await createArtifact();
  await addPreviews(root);
  await execFileAsync(process.execPath, [verifier, root, '--require-previews']);
});

test('rejects a missing preview set when previews are required', async () => {
  const root = await createArtifact();
  await verifyFailure(root, 'Pages artifact is missing portfolio previews', [
    '--require-previews',
  ]);
});

test('rejects a preview manifest that points at a missing image', async () => {
  const root = await createArtifact();
  await addPreviews(root);
  await import('node:fs/promises').then(({ rm }) =>
    rm(join(root, 'previews/antipodes-en.webp')),
  );
  await verifyFailure(
    root,
    'Portfolio preview image is missing: previews/antipodes-en.webp',
  );
});

test('rejects preview files the manifest does not reference', async () => {
  const root = await createArtifact();
  await addPreviews(root);
  await writeFile(join(root, 'previews/sunline-zh.webp'), 'RIFF0000WEBP');
  await verifyFailure(root, 'Unreferenced portfolio preview files');
});

test('rejects a preview manifest without a localized question', async () => {
  const root = await createArtifact();
  await addPreviews(root);
  const path = join(root, 'previews/manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.modes[0].question.en = '';
  await writeFile(path, JSON.stringify(manifest));
  await verifyFailure(root, 'Portfolio preview text is missing: antipodes');
});

test('rejects an unsupported preview manifest schema', async () => {
  const root = await createArtifact();
  await addPreviews(root, { schemaVersion: 2 });
  await verifyFailure(root, 'Unsupported portfolio preview manifest schema');
});

test('Pages workflow publishes verified portfolio previews', async () => {
  const workflow = await readFile(
    resolve('.github/workflows/pages.yml'),
    'utf8',
  );
  assert.match(workflow, /node scripts\/capture-portfolio-previews\.mjs dist/);
  assert.match(workflow, /needs: \[build, e2e, previews\]/);
  assert.match(
    workflow,
    /node scripts\/verify-pages-artifact\.mjs dist --require-previews/,
  );
});

test('Pages workflow serializes the complete production deployment', async () => {
  const workflow = await import('node:fs/promises').then(({ readFile }) =>
    readFile(resolve('.github/workflows/pages.yml'), 'utf8'),
  );
  const workflowConcurrency = workflow.indexOf('\nconcurrency:');
  const jobs = workflow.indexOf('\njobs:');

  assert.ok(workflowConcurrency > 0 && workflowConcurrency < jobs);
  assert.match(workflow, /github-pages-production/);
  assert.match(workflow, /github-pages-pr-\{0\}/);
  assert.match(workflow, /github\.event\.pull_request\.number/);
  assert.match(workflow, /cancel-in-progress: true/);
});
