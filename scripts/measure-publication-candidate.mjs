import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

import { chromium, devices } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const mountPath = '/mundus/';
const scenarioIdentity = 'mundus-v1.1-publication-candidate-v4';

export function median(values) {
  if (!values.length)
    throw new Error('Cannot calculate a median without values.');
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function validateMeasurementResult(result) {
  if (result.schemaVersion !== 4) {
    throw new Error(`Unexpected schema version: ${result.schemaVersion}`);
  }
  if (result.scenarioIdentity !== scenarioIdentity) {
    throw new Error(`Unexpected scenario identity: ${result.scenarioIdentity}`);
  }
  if (!result.buildIdentity?.assets?.length) {
    throw new Error('Build asset identity is empty.');
  }
  for (const [name, expected] of [
    ['desktop', '50m'],
    ['pixel7', '110m'],
  ]) {
    const samples = result.scenarios?.[name]?.samples ?? [];
    if (samples.length < 3)
      throw new Error(`${name} requires at least 3 samples.`);
    samples.forEach((sample, index) => {
      const label = `${name} sample ${index + 1}`;
      const observation = sample.readinessObservation;
      if (observation?.mode !== 'concurrent-condition-polling') {
        throw new Error(
          `${label} readiness conditions were not observed concurrently.`,
        );
      }
      if (observation.globeUsableObservedAtMs < observation.startedAtMs) {
        throw new Error(
          `${label} globe readiness observation predates observation start.`,
        );
      }
      if (observation.bilateralIndexObservedAtMs < observation.startedAtMs) {
        throw new Error(
          `${label} bilateral readiness observation predates observation start.`,
        );
      }
      if (sample.vector.detail !== expected) {
        throw new Error(
          `${label} selected ${sample.vector.detail}, expected ${expected}`,
        );
      }
      if (!sample.vector.asset) {
        throw new Error(`${label} has no vector asset.`);
      }
      if (sample.geonames.requestCount !== 1) {
        throw new Error(
          `${label} expected one GeoNames request, observed ${sample.geonames.requestCount}`,
        );
      }
      if (
        !sample.geonames.asset ||
        sample.geonames.decodedReadyMs < sample.geonames.asset.responseEndMs
      ) {
        throw new Error(
          `${label} decoded GeoNames before its response completed.`,
        );
      }
      if (
        sample.geonames.firstFocus.searchReadyMs <
        sample.geonames.firstFocus.focusAtMs
      ) {
        throw new Error(
          `${label} warm search became ready before first focus.`,
        );
      }
      const failures = sample.failures;
      for (const [field, value] of [
        ['consoleErrors', failures?.consoleErrors],
        ['pageErrors', failures?.pageErrors],
        ['requestFailures', failures?.requestFailures],
        ['duplicateFetches', sample.duplicateFetches],
      ]) {
        if (!Array.isArray(value)) {
          throw new Error(`${label} ${field} must be an explicit array.`);
        }
      }
      if (failures.consoleErrors.length) {
        throw new Error(`${label} recorded console errors.`);
      }
      if (failures.pageErrors.length) {
        throw new Error(`${label} recorded page errors.`);
      }
      if (failures.requestFailures.length) {
        throw new Error(`${label} recorded failed requests.`);
      }
      if (sample.duplicateFetches.length) {
        throw new Error(
          `${label} recorded unexpected duplicate asset fetches.`,
        );
      }
    });
    const identities = new Set(samples.map((sample) => sample.vector.asset));
    if (identities.size !== 1)
      throw new Error(`${name} vector asset identity changed.`);
  }
}

export function validateRepeatability(first, second) {
  validateMeasurementResult(first);
  validateMeasurementResult(second);
  if (first.executionIdentity === second.executionIdentity) {
    throw new Error('Execution identities must be distinct.');
  }
  if (first.schemaVersion !== second.schemaVersion) {
    throw new Error('Schema version changed between executions.');
  }
  if (first.scenarioIdentity !== second.scenarioIdentity) {
    throw new Error('Scenario identity changed between executions.');
  }
  if (first.gitHead !== second.gitHead) {
    throw new Error('Git HEAD changed between executions.');
  }
  if (
    JSON.stringify(first.environment) !== JSON.stringify(second.environment)
  ) {
    throw new Error('Measurement environment changed between executions.');
  }
  if (
    JSON.stringify(first.buildIdentity.assets) !==
    JSON.stringify(second.buildIdentity.assets)
  ) {
    throw new Error('Build asset identity changed between executions.');
  }
  for (const name of ['desktop', 'pixel7']) {
    if (
      JSON.stringify(first.scenarios[name].context) !==
      JSON.stringify(second.scenarios[name].context)
    ) {
      throw new Error(`${name} scenario context changed between executions.`);
    }
    const selections = (result) =>
      result.scenarios[name].samples.map((sample) => ({
        detail: sample.vector.detail,
        asset: sample.vector.asset,
      }));
    if (
      JSON.stringify(selections(first)) !== JSON.stringify(selections(second))
    ) {
      throw new Error(`${name} qualitative resource selection changed.`);
    }
  }
}

export async function closeResources(resources) {
  const errors = [];
  for (const resource of resources) {
    if (!resource) continue;
    try {
      await resource.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    throw new AggregateError(
      errors,
      `Failed to close ${errors.length} measurement resource${errors.length === 1 ? '' : 's'}.`,
    );
  }
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function buildIdentity() {
  return {
    assets: filesUnder(join(dist, 'assets'))
      .map((path) => ({
        path: relative(dist, path).split(sep).join('/'),
        bytes: statSync(path).size,
        sha256: sha256(path),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.mvg': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith(mountPath)) {
      response.writeHead(404).end();
      return;
    }
    const requested = decodeURIComponent(url.pathname.slice(mountPath.length));
    const path = resolve(dist, requested || 'index.html');
    if (path !== dist && !path.startsWith(`${dist}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      if (!statSync(path).isFile()) throw new Error('Not a file');
    } catch {
      response.writeHead(404).end();
      return;
    }
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream',
    };
    if (request.headers['accept-encoding']?.includes('gzip')) {
      response.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
      createReadStream(path).pipe(createGzip()).pipe(response);
    } else {
      response.writeHead(200, headers);
      createReadStream(path).pipe(response);
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('No server port.');
      resolvePromise({
        server,
        url: `http://127.0.0.1:${address.port}${mountPath}`,
      });
    });
  });
}

function resource(entry) {
  return {
    name: new URL(entry.name).pathname,
    initiatorType: entry.initiatorType,
    startTimeMs: entry.startTime,
    responseEndMs: entry.responseEnd,
    transferBytes: entry.transferSize,
    encodedBodyBytes: entry.encodedBodySize,
    decodedBodyBytes: entry.decodedBodySize,
  };
}

async function resourceEntries(page) {
  return page.evaluate(() =>
    performance.getEntriesByType('resource').map((candidate) => {
      const entry = candidate;
      return {
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        responseEnd: entry.responseEnd,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
      };
    }),
  );
}

async function heapBytes(cdp) {
  try {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return (
      metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? null
    );
  } catch {
    return null;
  }
}

async function measureSample(baseURL, scenario, run) {
  let browser;
  let context;
  let page;
  let cdp;
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const requestFailures = [];
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext(scenario.context);
    page = await context.newPage();
    cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
      if (message.type() === 'warning') consoleWarnings.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) =>
      requestFailures.push({
        url: request.url(),
        error: request.failure()?.errorText,
      }),
    );

    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    const readinessObservationStartedAtMs = await page.evaluate(() =>
      performance.now(),
    );
    const [globeObservation, bilateralObservation] = await Promise.all([
      page.waitForFunction(() => {
        const globe = document.querySelector('[data-vector-state="ready"]');
        return Number(globe?.getAttribute('data-vector-renderer-calls')) >= 4
          ? performance.now()
          : false;
      }),
      page.waitForFunction(() =>
        document.querySelector('[data-antipode-relation-state="ready"]')
          ? performance.now()
          : false,
      ),
    ]);
    const [firstUsableMs, geonamesDecodedReadyMs] = await Promise.all([
      globeObservation.jsonValue(),
      bilateralObservation.jsonValue(),
    ]);
    const initialHeap = await heapBytes(cdp);
    const initialEntries = (await resourceEntries(page)).filter(
      (entry) => entry.responseEnd <= firstUsableMs,
    );
    const initialCode = initialEntries.filter((entry) =>
      /\.(?:js|css)$/u.test(new URL(entry.name).pathname),
    );
    const vectorEntry = initialEntries.find((entry) =>
      entry.name.includes('natural-earth-vector-globe'),
    );
    const vectorDetail = await page
      .locator('[data-vector-state="ready"]')
      .getAttribute('data-vector-detail');

    const afterColdGeoNames = await resourceEntries(page);
    const geonamesEntries = afterColdGeoNames.filter((entry) =>
      entry.name.includes('geonames-major-cities'),
    );
    const geonamesEntry = geonamesEntries[0];
    const geonamesHeap = await heapBytes(cdp);

    if (scenario.name === 'pixel7') {
      await page.getByRole('button', { name: '展开地点控件' }).click();
    }
    const search = page.getByRole('combobox', { name: '搜索全球主要城市' });
    const focusAtMs = await page.evaluate(() => performance.now());
    await search.focus();
    await search.fill('Tokyo');
    await page.getByRole('option').first().waitFor({ state: 'visible' });
    const warmSearchReadyMs = await page.evaluate(() => performance.now());

    const finalEntries = await resourceEntries(page);
    const counts = new Map();
    for (const entry of finalEntries) {
      const path = new URL(entry.name).pathname;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }

    return {
      run,
      firstUsableMs,
      readinessObservation: {
        startedAtMs: readinessObservationStartedAtMs,
        globeUsableObservedAtMs: firstUsableMs,
        bilateralIndexObservedAtMs: geonamesDecodedReadyMs,
        mode: 'concurrent-condition-polling',
      },
      initialCode: {
        transferBytes: initialCode.reduce(
          (sum, entry) => sum + entry.transferSize,
          0,
        ),
        encodedBodyBytes: initialCode.reduce(
          (sum, entry) => sum + entry.encodedBodySize,
          0,
        ),
        assets: initialCode.map(resource),
      },
      geonames: {
        requestCount: geonamesEntries.length,
        decodedReadyMs: geonamesDecodedReadyMs,
        asset: geonamesEntry ? resource(geonamesEntry) : null,
        firstFocus: {
          focusAtMs,
          searchReadyMs: warmSearchReadyMs,
          focusToReadyMs: warmSearchReadyMs - focusAtMs,
        },
      },
      vector: {
        detail: vectorDetail,
        asset: vectorEntry ? new URL(vectorEntry.name).pathname : null,
        resource: vectorEntry ? resource(vectorEntry) : null,
      },
      heap: {
        supported: [initialHeap, geonamesHeap].every(Number.isFinite),
        observedBytes: [initialHeap, geonamesHeap],
        peakObservedBytes: [initialHeap, geonamesHeap]
          .filter(Number.isFinite)
          .reduce((peak, value) => Math.max(peak, value), 0),
      },
      failures: { consoleErrors, pageErrors, requestFailures },
      warnings: consoleWarnings,
      duplicateFetches: [...counts]
        .filter(([, count]) => count > 1)
        .map(([path, count]) => ({ path, count })),
    };
  } finally {
    await closeResources([
      cdp ? { close: () => cdp.detach() } : null,
      page,
      context,
      browser,
    ]);
  }
}

function summarize(samples) {
  const values = (select) => samples.map(select);
  return {
    firstUsableMs: median(values((sample) => sample.firstUsableMs)),
    initialCodeTransferBytes: median(
      values((sample) => sample.initialCode.transferBytes),
    ),
    geonamesRequestStartMs: median(
      values((sample) => sample.geonames.asset.startTimeMs),
    ),
    geonamesDecodedReadyMs: median(
      values((sample) => sample.geonames.decodedReadyMs),
    ),
    geonamesWarmFocusToReadyMs: median(
      values((sample) => sample.geonames.firstFocus.focusToReadyMs),
    ),
    geonamesTransferBytes: median(
      values((sample) => sample.geonames.asset.transferBytes),
    ),
    vectorTransferBytes: median(
      values((sample) => sample.vector.resource.transferBytes),
    ),
    peakObservedHeapBytes: samples.every((sample) => sample.heap.supported)
      ? median(values((sample) => sample.heap.peakObservedBytes))
      : null,
  };
}

async function main() {
  const requestedRuns = Number.parseInt(
    process.env.MUNDUS_PERF_RUNS ?? '3',
    10,
  );
  if (!Number.isInteger(requestedRuns) || requestedRuns < 3) {
    throw new Error('MUNDUS_PERF_RUNS must be an integer of at least 3.');
  }
  if (!statSync(join(dist, 'index.html')).isFile()) {
    throw new Error('dist/index.html is missing; run pnpm build first.');
  }
  const { server, url } = await startServer();
  try {
    let identityBrowser;
    let browserVersion;
    try {
      identityBrowser = await chromium.launch({ headless: true });
      browserVersion = identityBrowser.version();
    } finally {
      await closeResources([identityBrowser]);
    }
    const scenarios = {
      desktop: {
        name: 'desktop',
        context: {
          viewport: { width: 1280, height: 720 },
          deviceScaleFactor: 1,
          locale: 'zh-CN',
        },
      },
      pixel7: {
        name: 'pixel7',
        context: {
          ...devices['Pixel 7'],
          viewport: { width: 412, height: 839 },
          deviceScaleFactor: 2.625,
          locale: 'zh-CN',
        },
      },
    };
    const output = {
      schemaVersion: 4,
      executionIdentity: randomUUID(),
      scenarioIdentity,
      measuredAt: new Date().toISOString(),
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      environment: {
        node: process.version,
        playwrightChromium: browserVersion,
        platform: `${process.platform}-${process.arch}`,
        machine: execFileSync('sysctl', ['-n', 'hw.model'], {
          encoding: 'utf8',
        }).trim(),
        networkEmulation: 'none',
        mountPath,
      },
      buildIdentity: buildIdentity(),
      scenarios: {},
    };
    for (const [name, scenario] of Object.entries(scenarios)) {
      const samples = [];
      for (let run = 1; run <= requestedRuns; run += 1) {
        samples.push(await measureSample(url, scenario, run));
      }
      output.scenarios[name] = { context: scenario.context, samples };
      output.scenarios[name].medians = summarize(samples);
    }
    validateMeasurementResult(output);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await new Promise((resolvePromise, reject) =>
      server.close((error) => (error ? reject(error) : resolvePromise())),
    );
  }
}

async function run() {
  if (process.argv[2] === '--compare') {
    if (process.argv.length !== 5) {
      throw new Error(
        'Usage: measure-publication-candidate.mjs --compare first.json second.json',
      );
    }
    const [first, second] = process.argv
      .slice(3)
      .map((path) => JSON.parse(readFileSync(resolve(path), 'utf8')));
    validateMeasurementResult(first);
    validateMeasurementResult(second);
    validateRepeatability(first, second);
    process.stdout.write(
      `${JSON.stringify({
        scenarioIdentity: first.scenarioIdentity,
        firstExecutionIdentity: first.executionIdentity,
        secondExecutionIdentity: second.executionIdentity,
        assetCount: first.buildIdentity.assets.length,
        profiles: { desktop: '50m', pixel7: '110m' },
      })}\n`,
    );
    return;
  }
  await main();
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
