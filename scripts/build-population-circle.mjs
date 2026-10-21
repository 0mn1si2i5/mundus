// Builds the People in a Circle population grid from the pinned GHS-POP
// R2023A 2020 snapshot that Reshaped Earth already uses. The raw ZIP and its
// extraction stay in the shared external Reshaped Earth cache.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SOURCES } from './reshaped-earth/sources.mjs';
import { CACHE_DIR, fetchSource } from './reshaped-earth/fetch.mjs';
import { extractArchive } from './reshaped-earth/archive.mjs';
import { openGeoTiffReader } from './reshaped-earth/metrics.mjs';
import { writeRgbPng } from './reshaped-earth/png.mjs';
import {
  aggregateToGrid,
  countsToRgb,
  quantizeGrid,
} from './population-circle/aggregate.mjs';
import { findSmallestHalfCircle } from './population-circle/search.mjs';

const GRID = { width: 1440, height: 720, cellDegrees: 0.25 };
const ASSET_PATH = 'src/data/generated/population-circle-0p25.png';
const MANIFEST_PATH = 'src/data/manifests/population-circle.json';
const WORLD_POPULATION_2020 = 7.8e9;

const log = (message) =>
  console.log(`[population-circle] ${new Date().toISOString()} ${message}`);

async function main() {
  const source = SOURCES.population;
  log(`using cache ${CACHE_DIR}`);
  const fetched = await fetchSource('population');
  const extracted = await extractArchive({
    ...fetched,
    sha256: source.sha256,
    cacheDir: CACHE_DIR,
    key: 'population',
  });
  const member = source.fileName.replace(/\.zip$/, '.tif');
  if (!extracted.members.some((entry) => entry.name === member))
    throw new Error('Unexpected population ZIP member');
  const reader = await openGeoTiffReader(join(extracted.directory, member), {
    key: 'population',
  });
  const started = Date.now();
  let lastReport = 0;
  const aggregate = await aggregateToGrid(reader, {
    width: GRID.width,
    height: GRID.height,
    onProgress: (fraction) => {
      if (Date.now() - lastReport > 30_000) {
        lastReport = Date.now();
        log(`aggregated ${(fraction * 100).toFixed(1)}% of source rows`);
      }
    },
  }).finally(() => reader.close());
  log(
    `aggregation done in ${Math.round((Date.now() - started) / 1000)} s; total ${aggregate.sourceTotal}`,
  );
  if (
    Math.abs(aggregate.sourceTotal - WORLD_POPULATION_2020) /
      WORLD_POPULATION_2020 >
    0.02
  )
    throw new Error(
      `World total ${aggregate.sourceTotal} is not within 2% of 7.8 billion`,
    );
  const grid = quantizeGrid(aggregate);
  const png = writeRgbPng(grid.width, grid.height, countsToRgb(grid));
  log(`encoded ${png.length} bytes, ${grid.populatedCells} populated cells`);
  const smallest = findSmallestHalfCircle(
    {
      width: grid.width,
      height: grid.height,
      counts: Float64Array.from(grid.counts, (count) => count * grid.unit),
    },
    {
      onProgress: (fraction) =>
        log(`refined ${(fraction * 100).toFixed(0)}% of candidates`),
    },
  );
  log(`smallest half circle ${JSON.stringify(smallest)}`);
  const manifest = {
    id: 'population-circle',
    formatVersion: 1,
    sourceName: 'GHS-POP R2023A',
    sourceUrl: source.landingUrl,
    licenseName: 'CC BY 4.0',
    licenseUrl: source.licenceUrl,
    version: `${source.version}, epoch ${source.year}, WGS84 30 arcseconds`,
    retrievedAt: source.retrievedAt,
    attribution:
      'Schiavina, Freire, Carioli & MacManus (2023), GHS-POP R2023A, European Commission, Joint Research Centre (JRC), DOI 10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE',
    redistribution: 'allowed',
    source: {
      fileName: source.fileName,
      url: source.url,
      sha256: source.sha256,
      bytes: source.bytes,
    },
    transformations: [
      'Sum every 30-arcsecond source pixel into the 0.25° cell containing its centre (Kahan-compensated)',
      'Round each cell to whole persons (or to the published unit when a cell exceeds 24 bits)',
      'Encode counts as RGB8 PNG: R × 65536 + G × 256 + B, multiplied by unit',
      'Smallest half-population circle: 2° coarse ranking, then 0.25° and 0.05° refinement on the published grid',
    ],
    missingValuePolicy:
      'The source declares every cell valid; zero means no modelled residents. Ocean and Antarctica are zero.',
    year: source.year,
    grid: {
      width: grid.width,
      height: grid.height,
      cellDegrees: GRID.cellDegrees,
      west: -180,
      north: 90,
      unit: grid.unit,
      encoding: 'RGB8: R * 65536 + G * 256 + B',
    },
    totals: {
      source: Math.round(aggregate.sourceTotal),
      published: grid.roundedTotal,
      populatedCells: grid.populatedCells,
      maximumCell: Math.round(grid.maximum),
    },
    smallestHalfCircle: smallest,
    derivedAsset: {
      path: ASSET_PATH,
      sha256: createHash('sha256').update(png).digest('hex'),
      bytes: png.length,
    },
  };
  await mkdir(dirname(ASSET_PATH), { recursive: true });
  await writeFile(ASSET_PATH, png);
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`wrote ${ASSET_PATH} and ${MANIFEST_PATH}`);
}

await main();
