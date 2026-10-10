import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  createCartogram,
  composeCartograms,
  densityInMappedSpace,
  measureTriangleOrientation,
  cartogramFromForwardGrid,
  summarizeAreaErrors,
} from './cartogram.mjs';
import { densityFromCoverage, computeCoveredUnitAreas } from './coverage.mjs';
import { encodeInverseField } from './inverse-encoding.mjs';
import { resourceMonitor } from './resources.mjs';
import { mappedDensityFromLabels } from './mapped-density.mjs';

export const METRIC_KEYS = ['population', 'gdp', 'co2', 'lights'];
export const LEVEL_KEYS = ['country', 'admin1'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function fieldDensity(coverage, classification, metric, level) {
  return densityFromCoverage(coverage, { ...classification, ...metric, level });
}

export function evaluateField(map, coverage, model, classification, level) {
  const actualAreas = computeCoveredUnitAreas(map, coverage, {
    parent:
      level === 'country' ? classification.adminToCountryIndex : undefined,
  });
  const areaErrors = summarizeAreaErrors(
    actualAreas,
    model.acceptanceTargetAreas,
    {
      shares: model.shares,
      minimumShare: 1e-4,
    },
  );
  const orientation = measureTriangleOrientation(map);
  return { actualAreas, areaErrors, orientation };
}

/** Build, measure, then retain a field outside the worktree. No publication. */
export async function buildProductionField({
  cacheDir,
  coverage,
  classification,
  metric,
  key,
  level,
  maxRounds = 6,
  initialBlur = 2,
  fingerprint,
  mappedLabels = true,
  initialMap,
}) {
  const monitor = resourceMonitor(`cartogram-${key}-${level}`, {
    maxRSS: 1.5 * 1024 ** 3,
  });
  const model = fieldDensity(coverage, classification, metric, level);
  let map = initialMap;
  let evaluation;
  let rounds = 0;
  const iterationResults = [];
  for (; rounds < maxRounds; rounds += 1) {
    const density = map
      ? mappedLabels
        ? (
            await mappedDensityFromLabels(
              map,
              model,
              classification,
              level,
              (detail) => monitor.progress(detail),
            )
          ).density
        : densityInMappedSpace(map, model.density).density
      : model.density;
    const correction = createCartogram({
      width: coverage.width,
      height: coverage.height,
      density,
      algorithm: 'gsm2018',
      blurSigma: initialBlur / 2 ** rounds,
      onProgress: (detail) =>
        monitor.progress({ ...detail, iteration: rounds + 1 }),
    });
    map = map ? composeCartograms(map, correction) : correction;
    evaluation = evaluateField(map, coverage, model, classification, level);
    iterationResults.push({
      iteration: rounds + 1,
      diagnostics: map.diagnostics,
      areaErrors: evaluation.areaErrors,
      orientation: evaluation.orientation,
    });
    monitor.progress(
      {
        iteration: rounds + 1,
        areaErrors: evaluation.areaErrors,
        orientation: evaluation.orientation,
      },
      true,
    );
    // Retain each completed positive map before expensive inverse encoding.
    const forward = Buffer.from(
      map.forwardGrid.buffer,
      map.forwardGrid.byteOffset,
      map.forwardGrid.byteLength,
    );
    await writeFile(join(cacheDir, `forward-${key}-${level}.f64`), forward);
    await writeFile(
      join(cacheDir, `field-progress-${key}-${level}.json`),
      JSON.stringify(
        {
          fingerprint,
          width: map.width,
          height: map.height,
          iterations: rounds + 1,
          iterationResults,
          diagnostics: map.diagnostics,
          forwardSha256: digest(forward),
        },
        null,
        2,
      ) + '\n',
    );
    if (evaluation.areaErrors.median < 0.05 && evaluation.areaErrors.p90 < 0.15)
      break;
    global.gc?.();
  }
  const encoded = await encodeInverseField(map, { metric: key, level });
  const acceptance = {
    algorithm: 'gsm2018-fast-flow',
    iterations: Math.min(rounds + 1, maxRounds),
    unitsChecked: evaluation.areaErrors.count,
    triangleOrientation: evaluation.orientation.positive,
    medianAreaError: evaluation.areaErrors.median,
    p90AreaError: evaluation.areaErrors.p90,
    roundTripP999Degrees: encoded.roundTrip.p999Degrees,
    roundTripMaxDegrees: encoded.roundTrip.maxDegrees,
    totalAreaRelativeError: evaluation.orientation.totalAreaRelativeError,
    quantizationMaxDegrees: encoded.quantizationMaxDegrees,
  };
  const budget = level === 'country' ? 250 * 1024 : 900 * 1024;
  const passes =
    acceptance.triangleOrientation &&
    acceptance.medianAreaError < 0.05 &&
    acceptance.p90AreaError < 0.15 &&
    acceptance.roundTripP999Degrees < 0.05 &&
    acceptance.roundTripMaxDegrees < 0.5 &&
    acceptance.totalAreaRelativeError < 1e-6 &&
    acceptance.quantizationMaxDegrees < 0.01 &&
    encoded.bytes.length <= budget;
  const result = {
    fingerprint,
    key,
    level,
    passes,
    acceptance,
    encodedBytes: encoded.bytes.length,
    header: encoded.header,
    inverseSha256: digest(encoded.bytes),
    actualAreas: Object.fromEntries(evaluation.actualAreas),
    trueAreas: Object.fromEntries(model.trueAreas),
    shares: Object.fromEntries(model.shares),
    densityDiagnostics: model.diagnostics,
    resourceUsage: monitor.finish(),
  };
  await writeFile(join(cacheDir, `inverse-${key}-${level}.bin`), encoded.bytes);
  await writeFile(
    join(cacheDir, `field-${key}-${level}.json`),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      key,
      level,
      passes,
      acceptance,
      encodedBytes: encoded.bytes.length,
    }),
  );
  if (!passes)
    throw new Error(
      `S6: ${key}-${level} fails cartogram acceptance: ${JSON.stringify(acceptance)}; encoded bytes ${encoded.bytes.length}/${budget}`,
    );
  return result;
}

export async function loadForwardField(cacheDir, key, level) {
  const metadata = JSON.parse(
    await readFile(
      join(cacheDir, `field-progress-${key}-${level}.json`),
      'utf8',
    ),
  );
  const buffer = await readFile(join(cacheDir, `forward-${key}-${level}.f64`));
  if (digest(buffer) !== metadata.forwardSha256)
    throw new Error('Forward-field cache hash mismatch');
  const copy = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return cartogramFromForwardGrid({
    ...metadata,
    forwardGrid: new Float64Array(copy),
  });
}
