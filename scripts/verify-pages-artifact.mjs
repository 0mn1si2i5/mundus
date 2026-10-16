import { lstat, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import vectorGlobeManifest from '../src/data/manifests/natural-earth-vector-globe.json' with { type: 'json' };

const args = process.argv.slice(2);
const requirePreviews = args.includes('--require-previews');
const root = resolve(args.find((arg) => !arg.startsWith('--')) ?? 'dist');
const files = new Set();
const vectorReferences = { '110m': [], '50m': [] };

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const stats = await lstat(absolute);
    const path = relative(root, absolute).split(sep).join('/');

    if (stats.isSymbolicLink()) {
      throw new Error(`Pages artifact must not contain symlinks: ${path}`);
    }
    if (stats.isDirectory()) await walk(absolute);
    else if (stats.isFile()) files.add(path);
  }
}

await walk(root);

const required = [
  'index.html',
  'favicon.svg',
  'LICENSE',
  'THIRD_PARTY_LICENSES.md',
  'THIRD_PARTY_NOTICES.md',
];
for (const path of required) {
  if (!files.has(path)) throw new Error(`Missing release artifact: ${path}`);
}

const sourceMaps = [...files].filter((path) => /\.map$/i.test(path));
if (sourceMaps.length > 0) {
  throw new Error(
    `Production source maps are prohibited: ${sourceMaps.join(', ')}`,
  );
}

const index = await readFile(resolve(root, 'index.html'), 'utf8');
if (!index.includes('<title>Mundus · 交互式三维地球实验室</title>')) {
  throw new Error('Unexpected production document title.');
}
if (!index.includes('<div id="root"></div>')) {
  throw new Error('Production document is missing the application root.');
}

const references = [
  ...index.matchAll(/\b(?:href|src)=["']([^"'#?]+)["']/g),
].map((match) => match[1]);
for (const reference of references) {
  if (/^(?:[a-z]+:)?\/\//i.test(reference) || reference.startsWith('data:')) {
    continue;
  }
  if (reference.startsWith('/')) {
    throw new Error(`Root-relative asset breaks project Pages: ${reference}`);
  }
  const path = reference.replace(/^\.\//, '');
  if (!files.has(path))
    throw new Error(`Missing referenced asset: ${reference}`);
}

for (const sourcePath of [...files].filter((path) =>
  /\.(?:html|js|css)$/.test(path),
)) {
  const source = await readFile(resolve(root, sourcePath), 'utf8');
  if (/sourceMappingURL\s*=/.test(source)) {
    throw new Error(`Inline source-map reference in ${sourcePath}`);
  }
  const rootRelativeReferences = [
    ...source.matchAll(
      /["'(]((?:\/(?!\/))[^"'()`?#\s]+\.(?:js|css|svg|json|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|wasm|mvg))(?:[?#][^"'()`\s]*)?["')]/gi,
    ),
  ].map((match) => match[1]);
  if (rootRelativeReferences.length > 0) {
    throw new Error(
      `Root-relative asset breaks project Pages in ${sourcePath}: ${rootRelativeReferences.join(', ')}`,
    );
  }
  const relativeReferences = [
    ...source.matchAll(
      /(\.\.?\/[A-Za-z0-9_./-]+\.(?:js|css|svg|json|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|wasm|mvg))\b/gi,
    ),
  ].map((match) => match[1]);
  const sourceDirectory = resolve(root, sourcePath, '..');

  for (const reference of relativeReferences) {
    const target = relative(root, resolve(sourceDirectory, reference))
      .split(sep)
      .join('/');
    if (target.startsWith('../') || !files.has(target)) {
      throw new Error(`Broken asset reference in ${sourcePath}: ${reference}`);
    }
  }

  if (sourcePath.endsWith('.js')) {
    const emittedVectorUrls = [
      ...source.matchAll(
        /new URL\(["']([^"']+\.mvg)["'],\s*import\.meta\.url\)/g,
      ),
    ].map((match) => match[1]);
    for (const reference of emittedVectorUrls) {
      const target = relative(root, resolve(sourceDirectory, reference))
        .split(sep)
        .join('/');
      if (!/^assets\/[^/]+\.mvg$/.test(target) || !files.has(target)) {
        throw new Error(
          `Broken asset reference in ${sourcePath}: ${reference}`,
        );
      }
      for (const detail of ['110m', '50m']) {
        if (
          new RegExp(
            `^assets/natural-earth-vector-globe-${detail}-.+\\.mvg$`,
          ).test(target)
        ) {
          vectorReferences[detail].push(target);
        }
      }
    }
  }
}

if (![...files].some((path) => /^assets\/.+\.js$/.test(path))) {
  throw new Error('Pages artifact contains no JavaScript bundle.');
}
if (![...files].some((path) => /^assets\/.+\.css$/.test(path))) {
  throw new Error('Pages artifact contains no stylesheet bundle.');
}

for (const detail of ['110m', '50m']) {
  const references = vectorReferences[detail];
  if (references.length !== 1) {
    throw new Error(`Expected exactly one ${detail} vector globe reference`);
  }
  const bytes = await readFile(resolve(root, references[0]));
  const expected = vectorGlobeManifest.derivedAssets[detail];
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== expected.rawBytes || sha256 !== expected.sha256) {
    throw new Error(`${detail} vector globe identity mismatch`);
  }
  if (detail === '50m') {
    const { gzipSync } = await import('node:zlib');
    const gzipBytes = gzipSync(bytes, { level: 9, mtime: 0 }).byteLength;
    if (gzipBytes > 1.5 * 1024 * 1024) {
      throw new Error(`50m vector globe gzip budget exceeded: ${gzipBytes}`);
    }
  }
}

// Portfolio previews: written by scripts/capture-portfolio-previews.mjs in the
// Pages workflow and read by external pages, so the manifest must stay valid.
const previewFiles = [...files].filter((path) => path.startsWith('previews/'));
if (requirePreviews && previewFiles.length === 0) {
  throw new Error('Pages artifact is missing portfolio previews.');
}
if (previewFiles.length > 0) {
  if (!files.has('previews/manifest.json')) {
    throw new Error('Portfolio previews have no manifest.');
  }
  const manifest = JSON.parse(
    await readFile(resolve(root, 'previews/manifest.json'), 'utf8'),
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error('Unsupported portfolio preview manifest schema.');
  }
  if (!Array.isArray(manifest.modes) || manifest.modes.length === 0) {
    throw new Error('Portfolio preview manifest lists no modes.');
  }
  const referenced = new Set(['previews/manifest.json']);
  for (const mode of manifest.modes) {
    if (mode.href !== `../?v=2&mode=${mode.id}`) {
      throw new Error(`Portfolio preview link is invalid: ${mode.id}`);
    }
    for (const locale of ['zh', 'en']) {
      if (!mode.title?.[locale] || !mode.image?.alt?.[locale]) {
        throw new Error(`Portfolio preview text is missing: ${mode.id}`);
      }
      const path = `previews/${mode.image?.src?.[locale] ?? ''}`;
      if (!/^previews\/[a-z0-9-]+\.webp$/.test(path) || !files.has(path)) {
        throw new Error(`Portfolio preview image is missing: ${path}`);
      }
      referenced.add(path);
    }
  }
  const unreferenced = previewFiles.filter((path) => !referenced.has(path));
  if (unreferenced.length > 0) {
    throw new Error(
      `Unreferenced portfolio preview files: ${unreferenced.join(', ')}`,
    );
  }
}

const notices = await readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
if (notices.trim().length === 0) {
  throw new Error('Bundled dependency notices are empty.');
}
const emptyNotices = [...notices.matchAll(/^## (.+)\n\n(?=## |$)/gm)];
if (emptyNotices.length > 0) {
  throw new Error(
    `Bundled dependencies without license text: ${emptyNotices
      .map((match) => match[1])
      .join(', ')}`,
  );
}

console.log(
  `Verified Pages artifact: ${files.size} files, ${references.length} document assets, 0 source maps.`,
);
