import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CACHE_DIR,
  captureSources,
  fetchSource,
} from './reshaped-earth/fetch.mjs';
import { SOURCES } from './reshaped-earth/sources.mjs';
import { buildUnits } from './reshaped-earth/units.mjs';
import { aggregateMetric } from './reshaped-earth/metrics.mjs';

// Source capture and classification are independently resumable. Production
// publication is deliberately unavailable until the remaining CO2 reader and
// all eight encoded-field acceptance results have been verified. This script
// must never synthesize substitute numbers or publish placeholder geometry.
const phase = process.argv.find((arg) => arg.startsWith('--phase='))?.slice(8);
if (process.argv.includes('--capture')) {
  await captureSources();
} else if (phase === 'units') {
  const sources = {};
  for (const key of ['chn', 'default', 'admin1']) {
    sources[key] = JSON.parse(
      await readFile((await fetchSource(key)).path, 'utf8'),
    );
  }
  const result = await buildUnits({
    cacheDir: CACHE_DIR,
    chn: sources.chn,
    defaultView: sources.default,
    admin1: sources.admin1,
    onProgress: (progress) => console.log(JSON.stringify(progress)),
  });
  await writeFile(
    join(CACHE_DIR, 'units-build.json'),
    `${JSON.stringify({ ...result, adminToCountryIndex: [...result.adminToCountryIndex] }, null, 2)}\n`,
  );
  console.log(`Classification retained at ${result.labelPath}`);
} else if (phase === 'aggregate') {
  const classification = JSON.parse(
    await readFile(join(CACHE_DIR, 'units-build.json'), 'utf8'),
  );
  classification.adminToCountryIndex = Uint16Array.from(
    classification.adminToCountryIndex,
  );
  const metrics = {};
  for (const key of ['population', 'gdp', 'lights']) {
    const source = await fetchSource(key);
    const path =
      key === 'population'
        ? join(CACHE_DIR, SOURCES.population.fileName.replace(/\.zip$/, '.tif'))
        : source.path;
    // ZIP extraction must first be verified against its actual member list.
    // A missing reviewed extraction is reported, never guessed/downloaded.
    metrics[key] = await aggregateMetric({
      key,
      path,
      ...classification,
      units: classification.units,
    });
  }
  await writeFile(
    join(CACHE_DIR, 'metrics-build.json'),
    `${JSON.stringify(metrics, null, 2)}\n`,
  );
  throw new Error(
    'Production publication pending: inspect complete GridFED 2020 archive, implement its metadata-validated CO2 reader, then validate all eight encoded cartograms. No generated asset changed.',
  );
} else {
  throw new Error(
    'Reshaped Earth production build is incomplete; no generated asset changed. Use --capture, --phase=units or --phase=aggregate only after the resource gate permits it.',
  );
}
