import { readFile, writeFile, stat, mkdir, copyFile } from 'node:fs/promises';
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
import { compareCountryTotals } from './reshaped-earth/aggregation.mjs';
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
} from './reshaped-earth/production-field.mjs';
import {
  QUANTIZATION_CHOICES,
  QUANTIZATION_SELECTION_RULE,
} from './reshaped-earth/inverse-encoding.mjs';
import { resourceMonitor } from './reshaped-earth/resources.mjs';
import { publishProductionAssets } from './reshaped-earth/publication.mjs';

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = arg('phase') ?? 'all';
const BUILD_DIR = join(CACHE_DIR, 'country-v4');
const FIELD_ORDER = ['lights', 'co2', 'gdp', 'population'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const saveJson = (path, object) =>
  writeFile(path, JSON.stringify(object, null, 2) + '\n');
const exists = async (path) => Boolean(await stat(path).catch(() => null));
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
  const monitor = resourceMonitor('classification');
  const c = await buildUnits({
    cacheDir: CACHE_DIR,
    chn: await json(sources.chn.path),
    defaultView: await json(sources.default.path),
    admin1: await json(sources.admin1.path),
    onProgress: monitor.progress,
  });
  c.resourceUsage = monitor.finish();
  await saveJson(join(CACHE_DIR, 'units-build.json'), {
    ...c,
    adminToCountryIndex: [...c.adminToCountryIndex],
  });
  cacheBudget();
  return c;
}
async function classificationIdentity(c) {
  const {
    resourceUsage: _resources,
    labelPath: _path,
    retainedTemporaryPaths: _temporary,
    ...stable
  } = c;
  return sha(
    JSON.stringify({
      classification: stable,
      labels: (await identity(c.labelPath)).sha256,
    }),
  );
}
async function aggregateFresh(c, sources, classificationHash, force) {
  const metrics = {};
  const readerHash = sha(
    await readFile(new URL('./reshaped-earth/metrics.mjs', import.meta.url)),
  );
  for (const key of METRIC_KEYS) {
    const output = join(BUILD_DIR, `metric-${key}.json`);
    const inputIdentity = sha(
      JSON.stringify({
        classificationHash,
        readerHash,
        source: SOURCES[key].sha256,
      }),
    );
    if (!force && (await exists(output))) {
      const result = await json(output);
      if (
        result.inputIdentity === inputIdentity &&
        result.countryComparison?.maximumRelativeError < 1e-9
      ) {
        metrics[key] = result;
        continue;
      }
    }
    const priorFreshPath = join(CACHE_DIR, 'country-v3', `metric-${key}.json`);
    if (!force && (await exists(priorFreshPath))) {
      const priorFresh = await json(priorFreshPath);
      if (
        priorFresh.inputIdentity === inputIdentity &&
        priorFresh.countryComparison?.maximumRelativeError < 1e-9
      ) {
        await copyFile(priorFreshPath, output);
        metrics[key] = priorFresh;
        continue;
      }
    }
    // Keep the prior result separate, and compare only after reading every source cell anew.
    const priorPath = join(CACHE_DIR, `metric-${key}.json`);
    const prior = (await exists(priorPath)) ? await json(priorPath) : null;
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
        onProgress: monitor.progress,
      });
      path = extracted.path;
      monitor.finish();
    }
    cacheBudget();
    const monitor = resourceMonitor(`aggregate-${key}`);
    const result = await aggregateMetric({
      key,
      path,
      ...c,
      onProgress: monitor.progress,
      enforcePopulationChecks: key === 'population',
      enforceCo2Checks: key === 'co2',
    });
    result.resourceUsage = monitor.finish();
    result.countryComparison = prior
      ? compareCountryTotals(
          key,
          result.countryValues,
          prior.countryValues,
          c.countries,
        )
      : null;
    result.inputIdentity = inputIdentity;
    metrics[key] = result;
    await saveJson(output, result);
    cacheBudget();
    console.log(
      JSON.stringify({
        key,
        freshAggregation: true,
        countryComparison: result.countryComparison,
      }),
    );
    global.gc?.();
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
    onProgress: monitor.progress,
  });
  await saveCoverage(path, coverage);
  monitor.finish();
  cacheBudget();
  return coverage;
}
async function inputFingerprint(classificationHash, metrics) {
  const inputs = {
    classificationHash,
    coverage: (await identity(join(CACHE_DIR, 'coverage-2048.cache'))).sha256,
  };
  for (const key of METRIC_KEYS) {
    const { resourceUsage: _resources, ...stable } = metrics[key];
    inputs[key] = sha(JSON.stringify(stable));
  }
  const modules = [
    'cartogram.mjs',
    'conservative-density.mjs',
    'coverage.mjs',
    'inverse-encoding.mjs',
    'production-field.mjs',
    'padding.mjs',
  ];
  const code = {};
  for (const name of modules)
    code[name] = sha(
      await readFile(new URL(`./reshaped-earth/${name}`, import.meta.url)),
    );
  for (const name of ['inverseFormat.mjs', 'inverseSampling.mjs'])
    code[name] = sha(
      await readFile(
        new URL(`../src/features/reshaped/${name}`, import.meta.url),
      ),
    );
  return sha(
    JSON.stringify({
      method: 'country-js-gsm2018-uniform-mre3',
      grid: [2048, 1024],
      initialBlur: 32,
      maxRounds: 16,
      blurSchedule: [32, 16, 8, 4, 2, 1, 0.5, 0.25],
      plateauImprovement: 0.005,
      plateauRounds: 3,
      inverse: {
        width: 1024,
        height: 512,
        choices: QUANTIZATION_CHOICES,
        selection: QUANTIZATION_SELECTION_RULE,
      },
      sources: Object.fromEntries(
        Object.entries(SOURCES).map(([k, s]) => [k, s.sha256]),
      ),
      inputs,
      code,
    }),
  );
}
async function verifyByteIdentity(
  key,
  firstDir,
  secondDir,
  includeInverse = true,
) {
  const hashes = {};
  for (const [kind, name] of [
    ['forward', `forward-${key}.f64`],
    ['inverse', `inverse-${key}.bin`],
    ['padding', `padding-${key}.u8`],
  ]) {
    if (kind === 'inverse' && !includeInverse) continue;
    const a = await readFile(join(firstDir, name)),
      b = await readFile(join(secondDir, name));
    if (!a.equals(b)) throw new Error(`S6′: ${key}: two ${kind} builds differ`);
    hashes[`${kind}Sha256`] = sha(a);
  }
  return { builds: 2, byteIdentical: true, ...hashes };
}
async function fieldsFor(c, metrics, coverage, fingerprint, force) {
  const fields = {},
    requested = arg('metric');
  if (requested && !METRIC_KEYS.includes(requested))
    throw new Error('Unknown metric');
  const secondDir = join(BUILD_DIR, 'determinism');
  await mkdir(secondDir, { recursive: true });
  for (const key of FIELD_ORDER) {
    if (requested && requested !== key) continue;
    const resultPath = join(BUILD_DIR, `field-${key}.json`);
    let result =
      !force && (await exists(resultPath)) ? await json(resultPath) : null;
    if (
      result?.fingerprint === fingerprint &&
      (result.passes || (key === 'gdp' && result.published === false)) &&
      result.determinism?.byteIdentical &&
      (await identity(join(BUILD_DIR, `padding-${key}.u8`))).sha256 ===
        result.paddingSha256 &&
      (!result.passes ||
        (await identity(join(BUILD_DIR, `inverse-${key}.bin`))).sha256 ===
          result.inverseSha256)
    ) {
      console.log(JSON.stringify({ resumedAcceptedField: key }));
    } else {
      const options = {
        coverage,
        classification: c,
        metric: metrics[key],
        key,
        fingerprint,
      };
      const build = async (cacheDir) => {
        try {
          return await buildProductionField({ ...options, cacheDir });
        } catch (error) {
          if (
            key !== 'gdp' ||
            !error.message.startsWith('S6′: gdp area acceptance failed:')
          )
            throw error;
          const failed = await json(join(cacheDir, `field-${key}.json`));
          if (failed.fingerprint !== fingerprint || failed.passes) throw error;
          failed.published = false;
          failed.failure = error.message;
          return failed;
        }
      };
      result = await build(BUILD_DIR);
      cacheBudget();
      global.gc?.();
      const second = await build(secondDir);
      cacheBudget();
      global.gc?.();
      result.determinism = await verifyByteIdentity(
        key,
        BUILD_DIR,
        secondDir,
        result.passes || Boolean(result.inverseSha256),
      );
      if (
        JSON.stringify(result.acceptance) !==
          JSON.stringify(second.acceptance) ||
        JSON.stringify(result.parameters) !==
          JSON.stringify(second.parameters) ||
        JSON.stringify(result.padding) !== JSON.stringify(second.padding)
      )
        throw new Error(
          `S6′: ${key}: two builds produce different measurements`,
        );
      result.resourceUsage = {
        first: result.resourceUsage,
        second: second.resourceUsage,
      };
      result.published = result.passes;
      await saveJson(resultPath, result);
      console.log(JSON.stringify({ key, determinism: result.determinism }));
    }
    fields[key] = result;
    cacheBudget();
    global.gc?.();
  }
  return fields;
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
  await mkdir(BUILD_DIR, { recursive: true });
  cacheBudget();
  try {
    const monitor = resourceMonitor('source-verification'),
      sources = {};
    for (const key of Object.keys(SOURCES)) {
      if (
        process.argv.includes('--offline') &&
        !(await exists(join(CACHE_DIR, SOURCES[key].fileName)))
      )
        throw new Error(`Missing offline source ${key}`);
      sources[key] = await fetchSource(key);
      monitor.progress({ source: key }, true);
    }
    monitor.finish();
    cacheBudget();
    const c =
      phase === 'units' || !(await exists(join(CACHE_DIR, 'units-build.json')))
        ? await classify(sources)
        : await loadClassification();
    if (phase !== 'units') {
      const classificationHash = await classificationIdentity(c);
      const metrics = await aggregateFresh(
        c,
        sources,
        classificationHash,
        phase === 'aggregate',
      );
      if (phase !== 'aggregate') {
        const coverage = await coverageFor(c, phase === 'coverage');
        if (phase !== 'coverage') {
          const fingerprint = await inputFingerprint(
            classificationHash,
            metrics,
          );
          const fields = await fieldsFor(
            c,
            metrics,
            coverage,
            fingerprint,
            process.argv.includes('--rebuild'),
          );
          if (phase === 'all' || phase === 'publish')
            await publishProductionAssets({
              cacheDir: CACHE_DIR,
              fieldDir: BUILD_DIR,
              classification: c,
              metrics,
              fields,
              fingerprint,
              cacheBudget,
            });
        }
      }
    }
  } catch (error) {
    await saveJson(join(BUILD_DIR, 'production-stop.json'), {
      message: error.message,
      phase,
      currentCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      cacheAllocatedBytes: cacheBudget(),
    });
    throw error;
  }
}
