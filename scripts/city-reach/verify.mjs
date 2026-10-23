import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { sha256 } from './friction.mjs';
import { allManifestAssets, validateCityAsset } from './schema.mjs';
import { decodeDensityPng, decodeOwnerPng } from './png.mjs';
import { DISPUTED_OWNER, MAX_TEXTURE_BYTES } from './config.mjs';
import { validateSourceSummary } from './source-capture.mjs';
export { validateSourceCapture } from './source-capture.mjs';
import { summarizeNameReview } from './names.mjs';
import { expandCityTable } from '../../src/features/isolation/cityReachTable.ts';
import { ghslCountryNameZh } from '../../src/features/globe/countryNames.ts';

export function validateRequiredNames(cityAsset, required) {
  const seen = new Map();
  for (const city of cityAsset.cities) {
    if (
      (required.has(city.id) && !city.name.en.trim()) ||
      !city.country.en.trim() ||
      !city.country.zh?.trim()
    )
      throw new Error(
        `City-reach required city ${city.id} lacks reviewed names`,
      );
    if (!city.name.zh?.trim()) continue;
    const prior = seen.get(city.name.zh);
    if (
      prior &&
      (prior.nameMatchType !== 'override' || city.nameMatchType !== 'override')
    )
      throw new Error(
        `City-reach Chinese name conflict: ${city.name.zh} (${prior.id}, ${city.id})`,
      );
    seen.set(city.name.zh, city);
  }
}

export async function verifyCityReach(root = process.cwd()) {
  const manifestPath = resolve(root, 'src/data/manifests/city-reach.json');
  try {
    await access(manifestPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    for (const path of [
      'src/data/generated/city-reach.json',
      'src/data/generated/city-reach-source-summary.json',
      'src/data/generated/city-reach-source-capture.json',
      'public/data/city-reach',
    ]) {
      try {
        await access(resolve(root, path));
      } catch (assetError) {
        if (assetError.code === 'ENOENT') continue;
        throw assetError;
      }
      throw new Error(`City-reach asset exists without its manifest: ${path}`);
    }
    return { present: false, assets: 0 };
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const assets = allManifestAssets(manifest);
  const texturePaths = new Set(
    assets
      .filter((asset) => asset.path.endsWith('.png'))
      .map((asset) => resolve(root, asset.path)),
  );
  for (const name of await readdir(resolve(root, 'public/data/city-reach'))) {
    if (
      name.endsWith('.png') &&
      !texturePaths.has(resolve(root, 'public/data/city-reach', name))
    )
      throw new Error(
        `Unlisted city-reach PNG is outside the approved texture budget: ${name}`,
      );
  }

  const cityBytes = await readFile(resolve(root, manifest.cityAsset.path));
  const cityAsset = validateCityAsset(
    expandCityTable(JSON.parse(cityBytes.toString('utf8')), ghslCountryNameZh),
  );
  if (manifest.recordCount !== cityAsset.cities.length)
    throw new Error('City-reach manifest record count mismatch');
  const summary = validateSourceSummary(
    JSON.parse(
      await readFile(resolve(root, manifest.sourceCapture.path), 'utf8'),
    ),
    manifest.grid,
  );
  const required = new Set(summary.requiredCityIds);
  const byId = new Map(cityAsset.cities.map((city) => [city.id, city]));
  if ([...required].some((id) => !byId.has(id)))
    throw new Error('City-reach full-grid required city identity is unknown');
  const observedRequired = new Set();
  const textureBytes = assets
    .filter((asset) => asset.path.endsWith('.png'))
    .reduce((sum, asset) => sum + asset.rawBytes, 0);
  if (textureBytes > MAX_TEXTURE_BYTES)
    throw new Error(
      'City-reach total PNG bytes exceed the 3 MB texture budget',
    );
  for (const city of cityAsset.cities) {
    if (city.status === 'root' || city.status === 'no_larger_reachable')
      observedRequired.add(city.id);
    if (city.parentId !== null) observedRequired.add(city.parentId);
  }
  for (const asset of assets) {
    const bytes =
      asset.path === manifest.cityAsset.path
        ? cityBytes
        : await readFile(resolve(root, asset.path));
    if (
      sha256(bytes) !== asset.sha256 ||
      bytes.length !== asset.rawBytes ||
      gzipSync(bytes, { level: 9, mtime: 0 }).length !== asset.gzipBytes
    )
      throw new Error(
        `City-reach asset identity/budget mismatch: ${asset.path}`,
      );
    if (asset.path.endsWith('.png')) {
      if (asset.path === manifest.densityAsset.path) {
        const decoded = decodeDensityPng(bytes);
        if (decoded.width !== asset.width || decoded.height !== asset.height)
          throw new Error('Density texture dimensions disagree');
        continue;
      }
      const decoded = decodeOwnerPng(bytes);
      if (decoded.width !== asset.width || decoded.height !== asset.height)
        throw new Error(`Owner texture dimensions disagree: ${asset.path}`);
      for (const owner of new Set(decoded.owners)) {
        if (!owner || owner === DISPUTED_OWNER) continue;
        const city = cityAsset.cities[owner - 1];
        if (!city || city.ownerIndex !== owner)
          throw new Error(`Unknown owner ${owner} in ${asset.path}`);
        observedRequired.add(city.id);
      }
    }
  }
  if ([...observedRequired].some((id) => !required.has(id)))
    throw new Error(
      'City-reach full-grid required cities omit a displayed owner, parent or root',
    );
  validateRequiredNames(cityAsset, required);
  const nameReview = summarizeNameReview(cityAsset.cities, required);
  if (JSON.stringify(manifest.nameReview) !== JSON.stringify(nameReview))
    throw new Error('City-reach manifest name-review counts mismatch');
  return { present: true, assets: assets.length };
}
