import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const assets = [
  {
    manifest: 'src/data/manifests/natural-earth-110m.json',
    asset: 'node_modules/world-atlas/countries-110m.json',
    hashField: 'sha256',
  },
  {
    manifest: 'src/data/manifests/natural-earth-vector-globe.json',
    asset: 'node_modules/world-atlas/countries-50m.json',
    hashField: 'sourceAssets.50m.sha256',
  },
  {
    manifest: 'src/data/manifests/natural-earth-vector-globe.json',
    asset: 'src/data/generated/natural-earth-vector-globe-110m.mvg',
    hashField: 'derivedAssets.110m.sha256',
  },
  {
    manifest: 'src/data/manifests/natural-earth-vector-globe.json',
    asset: 'src/data/generated/natural-earth-vector-globe-50m.mvg',
    hashField: 'derivedAssets.50m.sha256',
  },
  {
    manifest: 'src/data/manifests/geonames-major-cities.json',
    asset: 'src/data/generated/geonames-major-cities-input.json',
    hashField: 'immutableBuildInput.sha256',
  },
  {
    manifest: 'src/data/manifests/geonames-major-cities.json',
    asset: 'src/data/generated/geonames-major-cities.json',
    hashField: 'derivedAsset.sha256',
    budgets: true,
  },
  {
    manifest: 'src/data/manifests/surnames-by-country.json',
    asset: 'src/data/generated/surnames-by-country.json',
    hashField: 'derivedAssetSha256',
    budgets: true,
  },
  {
    manifest: 'src/data/manifests/country-label-anchors.json',
    asset: 'src/data/generated/country-label-anchors.json',
    hashField: 'derivedAssetSha256',
  },
  {
    manifest: 'src/data/manifests/surname-label-slots.json',
    asset: 'src/data/generated/surname-label-slots.json',
    hashField: 'derivedAssetSha256',
  },
  {
    manifest: 'src/data/manifests/surname-coverage.json',
    asset: 'src/data/generated/surname-coverage.json',
    hashField: 'derivedAssetSha256',
  },
];

let failed = false;
for (const entry of assets) {
  const [manifestBytes, assetBytes] = await Promise.all([
    readFile(entry.manifest),
    readFile(entry.asset),
  ]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const expected = entry.hashField
    .split('.')
    .reduce((value, field) => value?.[field], manifest);
  const actual = createHash('sha256').update(assetBytes).digest('hex');
  if (typeof expected !== 'string' || actual !== expected) {
    failed = true;
    console.error(
      `${entry.asset}: expected ${String(expected)}, received ${actual}`,
    );
  } else {
    console.log(`${entry.asset}: verified ${actual}`);
  }
  if (entry.budgets) {
    const parsed = JSON.parse(assetBytes.toString('utf8'));
    const measurements = {
      recordCount:
        parsed.rows?.length ??
        Object.values(parsed.countries ?? {}).reduce(
          (count, country) => count + (country.records?.length ?? 0),
          0,
        ),
      rawBytes: assetBytes.byteLength,
      gzipBytes: gzipSync(assetBytes, { level: 9, mtime: 0 }).byteLength,
      staticDecodedBytesEstimate: assetBytes.byteLength * 4,
      runtimeDecodedBytesEstimate: parsed.rows
        ? estimateRuntimeDecodedBytes(parsed, assetBytes.byteLength)
        : assetBytes.byteLength * 6,
    };
    for (const [field, actualValue] of Object.entries(measurements)) {
      if (actualValue !== manifest[field]) {
        failed = true;
        console.error(
          `${entry.asset}: ${field} expected ${manifest[field]}, received ${actualValue}`,
        );
      }
    }
    if (
      manifest.id === 'surnames-by-country'
        ? measurements.recordCount > 400 ||
          measurements.rawBytes > 200 * 1024 ||
          measurements.gzipBytes > 80 * 1024 ||
          measurements.staticDecodedBytesEstimate > 800 * 1024 ||
          manifest.runtimeDecodedBytesEstimate > 2 * 1024 * 1024
        : measurements.recordCount > 10_000 ||
          measurements.rawBytes > 1.5 * 1024 * 1024 ||
          measurements.gzipBytes > 450 * 1024 ||
          measurements.staticDecodedBytesEstimate > 6 * 1024 * 1024 ||
          manifest.runtimeDecodedBytesEstimate > 8 * 1024 * 1024
    ) {
      failed = true;
      console.error(`${entry.asset}: GeoNames budget exceeded`);
    }
  }
}

if (failed) process.exitCode = 1;

function estimateRuntimeDecodedBytes(asset, serializedBytes) {
  // Keep in sync with the fixed-vector-tested build/runtime estimator.
  const normalized = new Set();
  let aliasReferences = 0;
  for (const row of asset.rows) {
    for (const index of row.slice(6, 12)) {
      normalized.add(index === null ? '' : normalize(asset.strings[index]));
    }
    for (const index of row[12]) {
      normalized.add(normalize(asset.strings[index]));
      aliasReferences += 1;
    }
  }
  let normalizedBytes = 0;
  for (const value of normalized) normalizedBytes += 24 + value.length * 2;
  return (
    serializedBytes * 4 +
    normalizedBytes +
    asset.rows.length * (64 + 6 * 8 + 24) +
    aliasReferences * 8
  );
}

function normalize(value) {
  return value
    .trim()
    .toLocaleLowerCase('und')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
