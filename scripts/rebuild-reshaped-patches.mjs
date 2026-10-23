/** Rebuild only local detail from hash-verified published inputs and pinned geometry. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { format, resolveConfig } from 'prettier';
import { SOURCES, mundusCountryFeatures } from './build-mundus-countries.mjs';
import { buildPatchAtlas } from './reshaped-earth/patches.mjs';
import { decodePngRgb } from '../src/features/reshaped/pngCore.mjs';
import { publishAssetSet } from './publish-asset-set.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceIndex = process.argv.indexOf('--source-dir');
if (sourceIndex < 0 || !process.argv[sourceIndex + 1])
  throw new Error(
    'Provide --source-dir containing pinned chn.geojson and default.geojson',
  );
const sourceDir = resolve(process.argv[sourceIndex + 1]);
const sources = {};
for (const key of ['chn', 'default']) {
  const bytes = await readFile(join(sourceDir, `${key}.geojson`));
  if (sha(bytes) !== SOURCES[key].sha256)
    throw new Error(`Source identity mismatch: ${key}`);
  sources[key] = JSON.parse(bytes);
}
const manifestPath = resolve('src/data/manifests/reshaped-earth.json');
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const assets = new Map();
for (const [name, descriptor] of Object.entries(manifest.derivedAssets)) {
  const bytes = await readFile(resolve(descriptor.path));
  if (bytes.length !== descriptor.rawBytes || sha(bytes) !== descriptor.sha256)
    throw new Error(`Published input identity mismatch: ${name}`);
  assets.set(name, bytes);
}
const units = JSON.parse(assets.get('units.json')).units;
const values = JSON.parse(assets.get('values.json')).rows;
const rows = new Map(values.map((row) => [row.id, row]));
// The atlas selects by effective/true area ratio, already published losslessly.
// Unit denominators preserve that exact ratio without re-running the solver.
const fields = Object.fromEntries(
  manifest.publishedMetrics.map((metric) => [
    metric,
    {
      trueAreas: Object.fromEntries(
        units.map((unit) => [unit.paletteIndex, 1]),
      ),
      effectiveAreas: Object.fromEntries(
        units.map((unit) => [
          unit.paletteIndex,
          rows.get(unit.id).areaRatio[metric] ?? 0,
        ]),
      ),
    },
  ]),
);
const packed = assets.get('ids-country.png');
const raster = await decodePngRgb(
  packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength),
);
if (raster.width !== 4096 || raster.height !== 2048)
  throw new Error('Published base raster has invalid dimensions');
const baseRaster = {
  width: raster.width,
  height: raster.height,
  ids: new Uint32Array(raster.ids.length),
  padding: new Uint8Array(raster.ids.length),
  distance: new Uint8Array(raster.ids.length),
};
for (let i = 0; i < raster.ids.length; i++) {
  baseRaster.ids[i] = raster.ids[i] >>> 16;
  baseRaster.padding[i] = (raster.ids[i] >>> 8) & 255;
  baseRaster.distance[i] = raster.ids[i] & 255;
}
const atlas = await buildPatchAtlas({
  classification: { countries: units },
  fields,
  publishedMetrics: manifest.publishedMetrics,
  countryFeatures: mundusCountryFeatures(sources.chn, sources.default),
  baseRaster,
});
const descriptor = Buffer.from(
  JSON.stringify({
    formatVersion: 1,
    encoding: 'country-padding-distance-rgb8-atlas',
    width: atlas.width,
    height: atlas.height,
    scale: 8,
    patches: atlas.entries,
    selection: atlas.selection,
    retainedSelection: atlas.retainedSelection,
    removals: atlas.removals,
    budgetSteps: atlas.budgetSteps,
  }) + '\n',
);
const replacements = new Map([
  ['ids-patches.png', atlas.png],
  ['ids-patches.json', descriptor],
]);
for (const [name, bytes] of replacements) {
  const entry = manifest.derivedAssets[name];
  Object.assign(entry, {
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 6 }).length,
    sha256: sha(bytes),
  });
  if (name.endsWith('.png'))
    Object.assign(entry, {
      width: atlas.width,
      height: atlas.height,
      patches: atlas.entries.length,
      gpuBytes: atlas.width * atlas.height * 3,
    });
}
manifest.patchBudget = { removals: atlas.removals, steps: atlas.budgetSteps };
const candidateManifest = await format(JSON.stringify(manifest), {
  ...(await resolveConfig(manifestPath)),
  filepath: manifestPath,
});
const stage = await mkdtemp(join(tmpdir(), 'mundus-patch-candidate-'));
try {
  for (const [name, bytes] of assets)
    await writeFile(join(stage, name), replacements.get(name) ?? bytes);
  await writeFile(join(stage, 'manifest.json'), candidateManifest);
  execFileSync(
    process.execPath,
    [
      resolve('scripts/verify-generated-data.mjs'),
      '--reshaped-manifest',
      join(stage, 'manifest.json'),
      '--reshaped-assets',
      stage,
    ],
    { stdio: 'inherit' },
  );
  // Do not overwrite inputs changed while the offline atlas was building.
  if (!(await readFile(manifestPath)).equals(manifestBytes))
    throw new Error('Published manifest changed during rebuild');
  for (const [name, bytes] of assets) {
    if (
      !(await readFile(resolve(manifest.derivedAssets[name].path))).equals(
        bytes,
      )
    )
      throw new Error(`Published input changed during rebuild: ${name}`);
  }
  await publishAssetSet([
    ...[...replacements].map(([name, bytes]) => ({
      path: resolve(manifest.derivedAssets[name].path),
      bytes,
    })),
    { path: manifestPath, bytes: Buffer.from(candidateManifest) },
  ]);
  console.log(
    JSON.stringify({
      patches: atlas.entries.length,
      countries: atlas.retainedSelection.length,
      gzipBytes: atlas.gzipBytes,
      gpuBytes: atlas.width * atlas.height * 3,
    }),
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
