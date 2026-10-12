import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  GLOBAL_GRID,
  LEVELS,
  MIN_POPULATION,
  estimateResources,
} from './city-reach/config.mjs';
import {
  loadFixedSources,
  readGhslCities,
  loadMapGrid,
} from './city-reach/sources.mjs';
import {
  rasterizeCountries,
  citySources,
  readPopulationGrid,
  densityBytes,
  regionalCities,
} from './city-reach/prepare.mjs';
import { makeGridGraph, validateGrid } from './city-reach/grid.mjs';
import {
  createWorkspace,
  solveOwnership,
  centreThresholds,
  monotonicityViolations,
  territoryConnectivity,
} from './city-reach/solver.mjs';
import { resolveCityNames, requireReviewedNames } from './city-reach/names.mjs';
import { publishCityReach } from './city-reach/publication.mjs';
import {
  computationIdentity,
  loadComputation,
  saveComputation,
} from './city-reach/computation-cache.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function regionGrid(text) {
  if (text.split(',').length !== 4)
    throw new Error('Region requires exactly four coordinates');
  const [west, south, east, north] = text.split(',').map(Number);
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    east <= west ||
    north <= south ||
    west < -180 ||
    east > 180 ||
    south < -60 ||
    north > 85
  )
    throw new Error(
      'Region must be west,south,east,north within the MAP coverage',
    );
  const width = Math.round((east - west) * 30);
  const height = Math.round((north - south) * 30);
  if (
    Math.abs(width / 30 - (east - west)) > 1e-8 ||
    Math.abs(height / 30 - (north - south)) > 1e-8 ||
    Math.abs(west * 30 - Math.round(west * 30)) > 1e-8 ||
    Math.abs(north * 30 - Math.round(north * 30)) > 1e-8
  )
    throw new Error('Region boundaries must align with the 1/30-degree grid');
  return validateGrid({
    width,
    height,
    west,
    north,
    step: 1 / 30,
    wrapLongitude: false,
  });
}

export async function auditExistingNames({
  root = ROOT,
  reportDirectory = resolve(root, 'tmp/city-reach'),
} = {}) {
  const input = JSON.parse(
    await readFile(
      resolve(root, 'src/data/generated/urban-isolation-input.json'),
      'utf8',
    ),
  );
  const cities = input.rows.map(
    (
      [id, sourceName, countryName, , population, latitude, longitude],
      index,
    ) => ({
      id: Number(id),
      ownerIndex: index + 1,
      sourceName,
      countryName,
      population,
      point: { latitude, longitude },
    }),
  );
  const names = await resolveCityNames(cities, root);
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = join(reportDirectory, 'prospective-name-review.json');
  await writeFile(
    reportPath,
    `${JSON.stringify({ scope: 'Prospective >=100,000 universe; required displayed set is determined by the new global solve, not the old 1,282-city asset', cities: names, missingChineseCities: names.filter((city) => !city.name.zh).length, missingChineseCountries: [...new Set(names.filter((city) => !city.country.zh).map((city) => city.country.en))] }, null, 2)}\n`,
  );
  return { cityCount: cities.length, reportPath };
}

export async function buildCityReach(options) {
  const {
    root = ROOT,
    grid = GLOBAL_GRID,
    cacheDirectory,
    capturePath,
    captureMap = false,
    benchmark = false,
    reencodeCacheIdentity,
    ghslZip,
    populationZip,
    reportDirectory = resolve(root, 'tmp/city-reach'),
    onProgress = () => {},
  } = options;
  const started = performance.now();
  if (!benchmark && JSON.stringify(grid) !== JSON.stringify(GLOBAL_GRID))
    throw new Error(
      'Regional grids are benchmark-only and cannot publish global assets',
    );
  await mkdir(cacheDirectory, { recursive: true });
  await mkdir(reportDirectory, { recursive: true });
  if (reencodeCacheIdentity) {
    const cached = await loadComputation(cacheDirectory, reencodeCacheIdentity);
    if (!cached || JSON.stringify(cached.grid) !== JSON.stringify(grid))
      throw new Error(
        'Re-encoding requires a complete matching computation cache',
      );
    onProgress({
      stage: 'reencode-computation',
      identity: reencodeCacheIdentity,
    });
    return finishComputation(cached, {
      ...options,
      root,
      reportDirectory,
      benchmark,
      cacheDirectory,
    });
  }
  let priorCapture = null;
  try {
    priorCapture = JSON.parse(await readFile(capturePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (
    priorCapture?.complete &&
    JSON.stringify(priorCapture.grid) === JSON.stringify(grid)
  ) {
    const identity = await computationIdentity(grid, priorCapture, benchmark);
    const cached = await loadComputation(cacheDirectory, identity);
    if (cached) {
      onProgress({ stage: 'reuse-computation', identity });
      return finishComputation(cached, {
        ...options,
        root,
        reportDirectory,
        benchmark,
      });
    }
  }
  if (!captureMap && !priorCapture)
    throw new Error(
      'No pinned MAP capture; first use --capture-map after the resource plan is authorised',
    );
  const sources = await loadFixedSources({
    cacheDirectory,
    ghslZip,
    populationZip,
  });
  const rawCities = await readGhslCities(sources.ghslPath, MIN_POPULATION);
  const cities = benchmark ? regionalCities(rawCities, grid) : rawCities;
  if (!cities.length)
    throw new Error('No competing cities in the selected grid');
  const map = await loadMapGrid({
    grid,
    cacheDirectory,
    capturePath,
    capture: captureMap,
    onProgress,
  });
  const countries = rasterizeCountries(sources.countries, grid, map.land);
  const population = await readPopulationGrid(
    sources.populationPath,
    grid,
    onProgress,
  );
  const prepared = citySources(
    cities,
    grid,
    map.land,
    countries.route,
    population,
  );
  const graph = makeGridGraph({
    grid,
    friction: map.friction,
    land: map.land,
    route: countries.route,
    countryCodes: countries.countryCodes,
    unknownLand: countries.unknownLand,
  });
  const workspace = createWorkspace(graph.size);
  const thresholdStarted = performance.now();
  const thresholds = centreThresholds(graph, prepared.cities, workspace);
  const thresholdSeconds = (performance.now() - thresholdStarted) / 1000;
  const thresholdVisitedCells = [...thresholds.values()].map(
    (result) => result.visitedCells,
  );
  onProgress({
    stage: 'thresholds',
    completed: prepared.cities.length,
    seconds: thresholdSeconds,
  });
  const levelOwners = new Map();
  const requiredIds = new Set();
  const byOwner = new Map(
    prepared.cities.map((city) => [city.ownerIndex, city]),
  );
  const levelReports = [];
  let previous = null;
  for (const level of LEVELS) {
    const begin = performance.now();
    const solved = solveOwnership(graph, prepared.cities, level, workspace);
    const owners = solved.owners;
    const violations = previous
      ? monotonicityViolations(previous, owners, prepared.cities, map.land)
      : 0;
    if (violations)
      throw new Error(
        `City-reach monotonicity failed at k=${level}: ${violations} cells`,
      );
    const fragments = territoryConnectivity(graph, owners, prepared.cities);
    if (fragments.length)
      throw new Error(
        `City-reach ownership has ${fragments.length} components without a city source at k=${level}`,
      );
    const territories = new Set();
    let unreachableCells = 0;
    let unreachablePopulation2020 = 0;
    let unreachablePopulationMissingCells = 0;
    let chosenPathsThroughUnknownCountryCells = 0;
    for (let cell = 0; cell < owners.length; cell += 1) {
      if (!map.land[cell]) continue;
      if (owners[cell] === 0) {
        unreachableCells += 1;
        if (Number.isFinite(population[cell]))
          unreachablePopulation2020 += population[cell];
        else unreachablePopulationMissingCells += 1;
      } else if (!countries.disputed[cell]) territories.add(owners[cell]);
      if (owners[cell] && solved.unknownPaths[cell])
        chosenPathsThroughUnknownCountryCells += 1;
    }
    for (const owner of territories) requiredIds.add(byOwner.get(owner).id);
    levelOwners.set(level, owners);
    previous = owners;
    levelReports.push({
      level,
      territories: territories.size,
      unreachableCells,
      unreachablePopulation2020,
      unreachablePopulationMissingCells,
      chosenPathsThroughUnknownCountryCells,
      monotonicityViolations: violations,
      disconnectedFragmentsWithoutSource: fragments.length,
      seconds: (performance.now() - begin) / 1000,
    });
    onProgress({
      stage: 'ownership',
      level,
      visitedCells: solved.visitedCells,
    });
  }
  for (const [id, threshold] of thresholds) {
    if (
      threshold.status === 'root' ||
      threshold.status === 'no_larger_reachable'
    )
      requiredIds.add(id);
    if (threshold.parentId !== null) requiredIds.add(threshold.parentId);
  }
  const { auditFineWaterways } =
    await import('./city-reach/fine-waterways.mjs');
  const actualWaterwaysAudit = await auditFineWaterways({
    grid,
    graph,
    capture: map.capture,
    cacheDirectory,
  });
  await writeFile(
    join(reportDirectory, 'fine-waterways.json'),
    `${JSON.stringify(actualWaterwaysAudit, null, 2)}\n`,
  );
  const report = {
    scope: benchmark
      ? 'regional benchmark, never a production asset'
      : 'global >=100,000 population universe',
    grid,
    cityCount: prepared.cities.length,
    countries: countries.report,
    crossborderClipping: prepared.clipped,
    states: Object.fromEntries(
      [...new Set([...thresholds.values()].map((result) => result.status))].map(
        (status) => [
          status,
          [...thresholds.values()].filter((result) => result.status === status)
            .length,
        ],
      ),
    ),
    levels: levelReports,
    resources: {
      estimated: estimateResources(grid, cities.length),
      seconds: (performance.now() - started) / 1000,
      thresholdSeconds,
      thresholdVisitedCellsTotal: thresholdVisitedCells.reduce(
        (sum, count) => sum + count,
        0,
      ),
      thresholdVisitedCellsMax: Math.max(...thresholdVisitedCells),
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
    },
    thresholds: Object.fromEntries(thresholds),
    narrowWaterways: {
      fineComponentCount: actualWaterwaysAudit.fineComponentCount,
      coarseLandCells: actualWaterwaysAudit.coarseLandCells,
      mixedCoarseCells: actualWaterwaysAudit.mixedCoarseCells,
      connectionCount: actualWaterwaysAudit.connections.length,
    },
  };
  await writeFile(
    join(reportDirectory, 'build-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const computation = {
    grid,
    cities: prepared.cities,
    thresholds,
    levelOwners,
    requiredIds,
    disputed: countries.disputed,
    density: densityBytes(population, grid),
    mapCapture: map.capture,
    waterwaysAudit: actualWaterwaysAudit,
    report,
  };
  const identity = await computationIdentity(grid, map.capture, benchmark);
  await saveComputation(cacheDirectory, identity, computation);
  onProgress({ stage: 'saved-computation', identity });
  return finishComputation(computation, {
    ...options,
    root,
    reportDirectory,
    benchmark,
  });
}

async function finishComputation(computation, options) {
  const { root, reportDirectory, benchmark, cacheDirectory } = options;
  const {
    grid,
    cities,
    thresholds,
    levelOwners,
    requiredIds,
    disputed,
    density,
    mapCapture,
    waterwaysAudit: actualWaterwaysAudit,
    report,
  } = computation;
  await writeFile(
    join(reportDirectory, 'fine-waterways.json'),
    `${JSON.stringify(actualWaterwaysAudit, null, 2)}\n`,
  );
  await writeFile(
    join(reportDirectory, 'build-report.json'),
    `${JSON.stringify({ ...report, reusedComputationCache: Boolean(computation.reusedCache) }, null, 2)}\n`,
  );
  if (benchmark) return { report, published: false };
  const names = await resolveCityNames(cities, root);
  await requireReviewedNames(
    names,
    requiredIds,
    join(reportDirectory, 'name-review.json'),
  );
  let narrowWaterwaysAudit = {
    ...actualWaterwaysAudit,
    reviewed: actualWaterwaysAudit.connections.length === 0,
  };
  if (options.narrowWaterwaysAudit) {
    narrowWaterwaysAudit = JSON.parse(
      await readFile(options.narrowWaterwaysAudit, 'utf8'),
    );
    if (
      narrowWaterwaysAudit.schemaVersion !== 1 ||
      narrowWaterwaysAudit.reviewed !== true ||
      narrowWaterwaysAudit.sourceDigest !== actualWaterwaysAudit.sourceDigest ||
      JSON.stringify(narrowWaterwaysAudit.connections) !==
        JSON.stringify(actualWaterwaysAudit.connections)
    )
      throw new Error(
        'Invalid, unreviewed, or changed narrow-waterway audit; approval must match the automatically generated source digest and connections',
      );
  }
  if (!narrowWaterwaysAudit.reviewed)
    throw new Error(
      `City reach publication awaits owner review of ${actualWaterwaysAudit.connections.length} narrow-waterway connections in ${join(reportDirectory, 'fine-waterways.json')}; no production assets were published.`,
    );
  return publishCityReach({
    root,
    grid,
    cities,
    names,
    thresholds,
    levelOwners,
    disputed,
    density,
    sourceCapture: { schemaVersion: 1, map: mapCapture, narrowWaterwaysAudit },
    captureArchiveDirectory: join(cacheDirectory, 'source-records'),
    retrievedAt: mapCapture.retrievedAt.slice(0, 10),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const argument = (name) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error(`Missing value for ${name}`);
    return args[index + 1];
  };
  const root = argument('--root') ? resolve(argument('--root')) : ROOT;
  if (args.includes('--audit-names')) {
    console.log(JSON.stringify(await auditExistingNames({ root }), null, 2));
    return;
  }
  const grid = argument('--region')
    ? regionGrid(argument('--region'))
    : GLOBAL_GRID;
  const cacheDirectory = resolve(
    argument('--cache') ?? join(homedir(), '.cache/mundus-data/city-reach'),
  );
  const capturePath = resolve(
    argument('--capture') ??
      join(
        cacheDirectory,
        `map-capture-${grid.west}-${grid.north}-${grid.width}-${grid.height}.json`,
      ),
  );
  if (
    args.includes('--estimate') ||
    (!args.includes('--build') &&
      !args.includes('--benchmark') &&
      !argument('--reencode-cache'))
  ) {
    console.log(
      JSON.stringify(
        {
          ...estimateResources(grid),
          cacheDirectory,
          retention:
            'Source archives, extracted source files, aggregate tile caches and the source capture stay outside Git until manually cleaned; raw MAP responses are not retained.',
          cleanup: `Remove only the dedicated city-reach cache directory ${cacheDirectory} after preserving its MAP capture for reproducibility.`,
          next: 'Use --benchmark --region west,south,east,north for a bounded experiment. A global --build must be authorised under AGENTS.md §7 before execution.',
        },
        null,
        2,
      ),
    );
    return;
  }
  if (
    args.includes('--benchmark') &&
    (!argument('--region') || grid.width * grid.height > 250_000)
  )
    throw new Error(
      'Benchmark needs a region of at most 250,000 cells; larger work requires a resource plan',
    );
  if (!args.includes('--benchmark') && argument('--region'))
    throw new Error(
      'Regional outputs are benchmark-only and cannot be published as global production assets',
    );
  const result = await buildCityReach({
    root,
    grid,
    cacheDirectory,
    capturePath,
    captureMap: args.includes('--capture-map'),
    reencodeCacheIdentity: argument('--reencode-cache'),
    benchmark: args.includes('--benchmark'),
    ghslZip: argument('--ghsl-zip'),
    populationZip: argument('--population-zip'),
    narrowWaterwaysAudit: argument('--waterway-audit'),
    onProgress: (progress) => console.log(JSON.stringify(progress)),
  });
  console.log(
    JSON.stringify(
      result.report
        ? { published: false, reportDirectory: resolve(root, 'tmp/city-reach') }
        : { published: true, cities: result.cityAsset.cities.length },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
