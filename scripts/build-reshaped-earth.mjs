import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  CACHE_DIR,
  captureSources,
  fetchSource,
  identity,
} from './reshaped-earth/fetch.mjs';
import { SOURCES } from './reshaped-earth/sources.mjs';
import { buildUnits } from './reshaped-earth/units.mjs';
import { aggregateMetric } from './reshaped-earth/metrics.mjs';
import {
  extractArchive,
  extractSparseMember,
} from './reshaped-earth/archive.mjs';
import {
  buildCoverage,
  loadCoverage,
  saveCoverage,
} from './reshaped-earth/coverage.mjs';
import {
  buildProductionField,
  METRIC_KEYS,
  LEVEL_KEYS,
} from './reshaped-earth/production-field.mjs';
import { resourceMonitor } from './reshaped-earth/resources.mjs';
import { publishProductionAssets } from './reshaped-earth/publication.mjs';

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = arg('phase') ?? 'all';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const saveJson = (path, object) =>
  writeFile(path, JSON.stringify(object) + '\n');
const exists = async (path) => Boolean(await stat(path).catch(() => null));
const progress = (detail) => console.log(JSON.stringify(detail));

function cacheBudget() {
  const kib = Number(
    execFileSync('du', ['-sk', CACHE_DIR], { encoding: 'utf8' }).split(
      /\s+/,
    )[0],
  );
  if (kib * 1024 > 15_000_000_000)
    throw new Error(`S3: cache allocation ${kib * 1024} exceeds 15 GB`);
  return kib * 1024;
}

async function loadClassification() {
  const c = await json(join(CACHE_DIR, 'units-build.json'));
  if (
    c.width !== 43200 ||
    c.height !== 21600 ||
    !Array.isArray(c.units) ||
    !Array.isArray(c.countries)
  )
    throw new Error('Invalid classification cache');
  c.adminToCountryIndex = Uint16Array.from(c.adminToCountryIndex);
  if ((await stat(c.labelPath)).size !== c.width * c.height * 2)
    throw new Error('Invalid label cache size');
  return c;
}

async function classify(sources) {
  const result = await buildUnits({
    cacheDir: CACHE_DIR,
    chn: await json(sources.chn.path),
    defaultView: await json(sources.default.path),
    admin1: await json(sources.admin1.path),
    onProgress: progress,
  });
  await saveJson(join(CACHE_DIR, 'units-build.json'), {
    ...result,
    adminToCountryIndex: [...result.adminToCountryIndex],
  });
  cacheBudget();
  return result;
}

async function aggregate(classification, sources, force) {
  const metrics = {};
  for (const key of METRIC_KEYS) {
    const output = join(CACHE_DIR, `metric-${key}.json`);
    if (!force && (await exists(output))) {
      metrics[key] = await json(output);
      if (
        !(metrics[key].diagnostics.relativeError < 1e-9) ||
        metrics[key].values.length !== classification.units.length + 1
      )
        throw new Error(`Invalid metric cache ${key}`);
      continue;
    }
    let path = sources[key].path;
    if (key === 'population') {
      const extracted = await extractArchive({
        ...sources[key],
        cacheDir: CACHE_DIR,
        key,
      });
      const member = SOURCES[key].fileName.replace(/\.zip$/, '.tif');
      if (!extracted.members.some((m) => m.name === member))
        throw new Error('Unexpected population ZIP member');
      path = join(extracted.directory, member);
    } else if (key === 'co2') {
      const monitor = resourceMonitor('GridFED-extraction');
      const extracted = await extractSparseMember({
        ...sources[key],
        member: 'GCP-GridFEDv2025.1_2020.nc',
        cacheDir: CACHE_DIR,
        key,
        maxAllocatedBytes: 10_000_000_000,
        onProgress: (d) => monitor.progress(d),
      });
      path = extracted.path;
      monitor.finish();
    }
    cacheBudget();
    const monitor = resourceMonitor(`aggregate-${key}`);
    metrics[key] = await aggregateMetric({
      key,
      path,
      ...classification,
      onProgress: (d) => monitor.progress(d),
    });
    metrics[key].resourceUsage = monitor.finish();
    await saveJson(output, metrics[key]);
    cacheBudget();
  }
  return metrics;
}

async function coverageFor(c, force) {
  const path = join(CACHE_DIR, 'coverage-2048.cache');
  if (!force && (await exists(path))) return loadCoverage(path);
  const monitor = resourceMonitor('triangle-coverage');
  const coverage = await buildCoverage({
    ...c,
    gridWidth: 2048,
    gridHeight: 1024,
    onProgress: (d) => monitor.progress(d),
  });
  await saveCoverage(path, coverage);
  monitor.finish();
  cacheBudget();
  return coverage;
}

async function inputFingerprint() {
  const inputs = {};
  for (const file of ['labels-admin1.u16', 'coverage-2048.cache'])
    inputs[file] = (await identity(join(CACHE_DIR, file))).sha256;
  // Rebuilding on a different machine changes timings and absolute cache
  // paths, not the science or generated assets. Exclude those operational
  // fields while retaining every value, name and boundary decision.
  const {
    resourceUsage: _classificationResources,
    labelPath: _labelPath,
    retainedTemporaryPaths: _temporaryPaths,
    ...classification
  } = await json(join(CACHE_DIR, 'units-build.json'));
  inputs['units-build.json'] = sha(JSON.stringify(classification));
  for (const key of METRIC_KEYS) {
    const { resourceUsage: _metricResources, ...metric } = await json(
      join(CACHE_DIR, `metric-${key}.json`),
    );
    inputs[`metric-${key}.json`] = sha(JSON.stringify(metric));
  }
  // A method label alone cannot invalidate a cached field after a solver or
  // encoding fix. Pin actual production module contents as well as options.
  const modules = [
    'scripts/build-reshaped-earth.mjs',
    ...(await readdir(new URL('./reshaped-earth/', import.meta.url)))
      .filter(
        (name) =>
          (name.endsWith('.mjs') && !name.endsWith('.test.mjs')) ||
          name.endsWith('.cpp'),
      )
      .map((name) => `scripts/reshaped-earth/${name}`),
    ...['inverseFormat.mjs', 'inverseSampling.mjs', 'metadata.mjs'].map(
      (name) => `src/features/reshaped/${name}`,
    ),
  ].sort();
  const code = {};
  for (const module of modules)
    code[module] = sha(
      await readFile(new URL(`../${module}`, import.meta.url)),
    );
  return sha(
    JSON.stringify({
      method: 'conservative-vertex-star-gsm2018-v1',
      grid: [2048, 1024],
      initialBlur: 32,
      maxRounds: 6,
      inverse: {
        rootWidth: 128,
        maxDepth: 8,
        toleranceDegrees: 0.025,
        verticalCoordinate: 'latitude',
      },
      sources: Object.fromEntries(
        Object.entries(SOURCES).map(([k, s]) => [k, s.sha256]),
      ),
      inputs,
      code,
    }),
  );
}

async function fieldsFor(c, metrics, coverage, force) {
  const fingerprint = await inputFingerprint();
  const fields = {};
  const requestedMetric = arg('metric'),
    requestedLevel = arg('level');
  if (requestedMetric && !METRIC_KEYS.includes(requestedMetric))
    throw new Error('Unknown metric');
  if (requestedLevel && !LEVEL_KEYS.includes(requestedLevel))
    throw new Error('Unknown level');
  for (const key of METRIC_KEYS)
    for (const level of LEVEL_KEYS) {
      if (
        (requestedMetric && key !== requestedMetric) ||
        (requestedLevel && level !== requestedLevel)
      )
        continue;
      const resultPath = join(CACHE_DIR, `field-${key}-${level}.json`);
      let result =
        !force && (await exists(resultPath)) ? await json(resultPath) : null;
      if (
        result?.fingerprint === fingerprint &&
        result.passes &&
        (await identity(join(CACHE_DIR, `inverse-${key}-${level}.bin`)))
          .sha256 === result.inverseSha256
      ) {
        progress({ resumed: `${key}-${level}` });
      } else {
        result = await buildProductionField({
          cacheDir: CACHE_DIR,
          coverage,
          classification: c,
          metric: metrics[key],
          key,
          level,
          fingerprint,
        });
      }
      fields[`${key}-${level}`] = result;
      cacheBudget();
      global.gc?.();
    }
  return { fields, fingerprint };
}

if (process.argv.includes('--capture')) {
  await captureSources();
} else {
  if (
    !['all', 'units', 'aggregate', 'coverage', 'fields', 'publish'].includes(
      phase,
    )
  )
    throw new Error('Unknown build phase');
  const sources = {};
  for (const key of Object.keys(SOURCES)) sources[key] = await fetchSource(key);
  cacheBudget();
  const c =
    phase === 'units' || !(await exists(join(CACHE_DIR, 'units-build.json')))
      ? await classify(sources)
      : await loadClassification();
  if (phase !== 'units') {
    const metrics = await aggregate(c, sources, phase === 'aggregate');
    if (phase !== 'aggregate') {
      const coverage = await coverageFor(c, phase === 'coverage');
      if (phase !== 'coverage') {
        const { fields, fingerprint } = await fieldsFor(
          c,
          metrics,
          coverage,
          process.argv.includes('--rebuild'),
        );
        if (phase === 'all' || phase === 'publish')
          await publishProductionAssets({
            cacheDir: CACHE_DIR,
            classification: c,
            metrics,
            fields,
            fingerprint,
            cacheBudget,
          });
      }
    }
  }
}
