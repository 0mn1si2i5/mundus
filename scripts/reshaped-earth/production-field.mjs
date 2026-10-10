import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  createCartogram,
  composeCartograms,
  regularizeCartogram,
  measureTriangleOrientation,
  cartogramFromForwardGrid,
  summarizeAreaErrors,
} from './cartogram.mjs';
import { densityFromCoverage, computeCoveredUnitAreas } from './coverage.mjs';
import { encodeInverseField } from './inverse-encoding.mjs';
import { resourceMonitor } from './resources.mjs';
import { conservativeMappedDensity } from './conservative-density.mjs';
import { computeCountryPadding, loadCountryRaster } from './padding.mjs';

export const METRIC_KEYS = ['population', 'gdp', 'co2', 'lights'];
export const BLUR_SCHEDULE = [32, 16, 8, 4, 2, 1, 0.5, 0.25];
export function iterationStopReason(history, maxRounds = 16) {
  const last = history.at(-1);
  if (!last) return null;
  if (last.areaErrors.median < 0.05 && last.areaErrors.p90 < 0.15)
    return 'raw-pass';
  if (
    history.length >= 4 &&
    history
      .slice(-3)
      .every(
        (entry, i) =>
          history[history.length - 4 + i].areaErrors.p90 -
            entry.areaErrors.p90 <
          0.005,
      )
  )
    return 'plateau';
  return last.iteration >= maxRounds ? 'max-rounds' : null;
}
export function largestCountryErrors(actualAreas, targets, shares, countries) {
  return countries
    .filter((country) => targets.get(country.paletteIndex) > 0)
    .map((country) => ({
      id: country.id,
      name: country.name.en,
      share: shares.get(country.paletteIndex),
      relativeError:
        actualAreas.get(country.paletteIndex) /
          targets.get(country.paletteIndex) -
        1,
    }))
    .sort(
      (a, b) =>
        Math.abs(b.relativeError) - Math.abs(a.relativeError) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 10);
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function fieldDensity(coverage, classification, metric) {
  return densityFromCoverage(coverage, { ...classification, ...metric });
}
export function evaluateField(map, coverage, model, classification) {
  const actualAreas = computeCoveredUnitAreas(map, coverage, {
    parent: classification.adminToCountryIndex,
  });
  const areaErrors = summarizeAreaErrors(
    actualAreas,
    model.acceptanceTargetAreas,
    { shares: model.shares, minimumShare: 1e-4 },
  );
  return {
    actualAreas,
    areaErrors,
    orientation: measureTriangleOrientation(map),
  };
}

/** The proven JS GSM2018 country method; bounded residual-density corrections. */
export async function buildProductionField({
  cacheDir,
  coverage,
  classification,
  metric,
  key,
  maxRounds = 16,
  initialBlur = 32,
  blurSchedule,
  integrationTolerance = 0.02 / 2048,
  fingerprint,
  initialMap,
  completedRounds = 0,
  previousIterations = [],
  raster,
}) {
  const monitor = resourceMonitor(`cartogram-${key}`);
  const model = fieldDensity(coverage, classification, metric);
  let map = initialMap;
  let evaluation = map
    ? evaluateField(map, coverage, model, classification)
    : undefined;
  let rounds = completedRounds;
  const iterationResults = [...previousIterations];
  let stopReason = iterationStopReason(iterationResults, maxRounds);
  const blurAt = (i) =>
    blurSchedule?.[i] ?? BLUR_SCHEDULE[Math.min(i, BLUR_SCHEDULE.length - 1)];
  for (; rounds < maxRounds && !stopReason; rounds += 1) {
    const density = map
      ? conservativeMappedDensity(
          map,
          coverage,
          model,
          evaluation.actualAreas,
          {
            parent: classification.adminToCountryIndex,
            onProgress: (d) => monitor.progress(d),
          },
        ).density
      : model.density;
    const correction = createCartogram({
      width: coverage.width,
      height: coverage.height,
      density,
      algorithm: 'gsm2018',
      blurSigma: blurAt(rounds),
      tolerance: integrationTolerance,
      onProgress: (d) => monitor.progress({ ...d, iteration: rounds + 1 }),
    });
    map = map
      ? regularizeCartogram(
          composeCartograms(map, correction, { preserveTopology: true }),
          { minimumJacobian: 0.001, passes: 8 },
        )
      : correction;
    evaluation = evaluateField(map, coverage, model, classification);
    iterationResults.push({
      iteration: rounds + 1,
      diagnostics: map.diagnostics,
      areaErrors: evaluation.areaErrors,
      orientation: evaluation.orientation,
      largestErrors: largestCountryErrors(
        evaluation.actualAreas,
        model.acceptanceTargetAreas,
        model.shares,
        classification.countries,
      ),
    });
    monitor.progress(
      {
        iteration: rounds + 1,
        areaErrors: evaluation.areaErrors,
        orientation: evaluation.orientation,
      },
      true,
    );
    const forward = Buffer.from(
      map.forwardGrid.buffer,
      map.forwardGrid.byteOffset,
      map.forwardGrid.byteLength,
    );
    await writeFile(join(cacheDir, `forward-${key}.f64`), forward);
    await writeFile(
      join(cacheDir, `field-progress-${key}.json`),
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
    stopReason = iterationStopReason(iterationResults, maxRounds);
    global.gc?.();
  }
  if (!evaluation || !map) throw new Error('No completed cartogram rounds');
  const parameters = {
    algorithm: 'gsm2018-fast-flow',
    grid: [coverage.width, coverage.height],
    initialBlur,
    blurSchedule: Array.from({ length: rounds }, (_, i) => blurAt(i)),
    integrationTolerance,
    maxRounds,
    minimumJacobian: 0.001,
    regularizationPasses: 8,
    stopReason,
  };
  const padding = computeCountryPadding({
    raster: raster ?? (await loadCountryRaster(classification)),
    map,
    countries: classification.countries,
    actualAreas: evaluation.actualAreas,
    targetAreas: model.acceptanceTargetAreas,
    onProgress: monitor.progress,
  });
  await writeFile(join(cacheDir, `padding-${key}.u8`), padding.mask);
  const effectiveErrors = summarizeAreaErrors(
    padding.effectiveAreas,
    model.acceptanceTargetAreas,
    { shares: model.shares, minimumShare: 1e-4 },
  );
  const acceptance = {
    iterations: rounds,
    unitsChecked: evaluation.areaErrors.count,
    triangleOrientation: evaluation.orientation.positive,
    minimumTriangleArea: evaluation.orientation.minimum,
    rawMedianAreaError: evaluation.areaErrors.median,
    rawP90AreaError: evaluation.areaErrors.p90,
    medianAreaError: effectiveErrors.median,
    p90AreaError: effectiveErrors.p90,
    totalAreaRelativeError: evaluation.orientation.totalAreaRelativeError,
  };
  const areaPasses = !(
    !acceptance.triangleOrientation ||
    acceptance.medianAreaError >= 0.05 ||
    acceptance.p90AreaError >= 0.15 ||
    acceptance.totalAreaRelativeError >= 1e-6
  );
  const areaResult = {
    fingerprint,
    key,
    passes: false,
    acceptance,
    parameters,
    padding: padding.summary,
    paddingSha256: digest(padding.mask),
    largestErrors: largestCountryErrors(
      evaluation.actualAreas,
      model.acceptanceTargetAreas,
      model.shares,
      classification.countries,
    ),
    actualAreas: Object.fromEntries(evaluation.actualAreas),
    effectiveAreas: Object.fromEntries(padding.effectiveAreas),
    trueAreas: Object.fromEntries(model.trueAreas),
    shares: Object.fromEntries(model.shares),
  };
  await writeFile(
    join(cacheDir, `field-${key}.json`),
    JSON.stringify(areaResult, null, 2) + '\n',
  );
  if (!areaPasses) {
    areaResult.resourceUsage = monitor.finish();
    await writeFile(
      join(cacheDir, `field-${key}.json`),
      JSON.stringify(areaResult, null, 2) + '\n',
    );
    throw new Error(
      `S6′: ${key} area acceptance failed: ${JSON.stringify({ acceptance, parameters })}`,
    );
  }
  const encoded = await encodeInverseField(map, {
    metric: key,
    onProgress: (d) => monitor.progress(d),
  });
  parameters.quantization = {
    rule: encoded.selection.rule,
    stepLongitudeFactor: encoded.stepLongitudeFactor,
    stepSFactor: encoded.stepSFactor,
    stepLongitude: encoded.header.stepLongitude,
    stepS: encoded.header.stepS,
  };
  Object.assign(acceptance, {
    displaySamples: encoded.roundTrip.samples,
    displaySeed: encoded.roundTrip.seed,
    displayP50Degrees: encoded.roundTrip.p50Degrees,
    displayP99Degrees: encoded.roundTrip.p99Degrees,
    displayP999Degrees: encoded.roundTrip.p999Degrees,
    displayMaxDegrees: encoded.roundTrip.maxDegrees,
    quantizationMaxDegrees: encoded.quantizationMaxDegrees,
  });
  const passes =
    acceptance.displayP99Degrees <= 0.1 &&
    acceptance.displayP999Degrees <= 0.5 &&
    acceptance.quantizationMaxDegrees < 0.01 &&
    encoded.bytes.length <= 1_200_000 &&
    encoded.gzipBytes <= 700_000;
  const result = {
    ...areaResult,
    passes,
    acceptance,
    parameters,
    encodedBytes: encoded.bytes.length,
    gzipBytes: encoded.gzipBytes,
    header: encoded.header,
    inverseSha256: digest(encoded.bytes),
    densityDiagnostics: model.diagnostics,
    inverseDiagnostics: encoded.diagnostics,
    quantizationSelection: encoded.selection,
    resourceUsage: monitor.finish(),
  };
  await writeFile(join(cacheDir, `inverse-${key}.bin`), encoded.bytes);
  await writeFile(
    join(cacheDir, `field-${key}.json`),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      key,
      passes,
      acceptance,
      parameters,
      encodedBytes: encoded.bytes.length,
    }),
  );
  if (!passes)
    throw new Error(
      `S6′: ${key} fails inverse acceptance: ${JSON.stringify(acceptance)}; encoded bytes ${encoded.bytes.length}/1200000; gzip6 ${encoded.gzipBytes}/700000`,
    );
  return result;
}
export async function loadForwardField(cacheDir, key) {
  const metadata = JSON.parse(
    await readFile(join(cacheDir, `field-progress-${key}.json`), 'utf8'),
  );
  const buffer = await readFile(join(cacheDir, `forward-${key}.f64`));
  if (digest(buffer) !== metadata.forwardSha256)
    throw new Error('Forward-field cache hash mismatch');
  return cartogramFromForwardGrid({
    ...metadata,
    forwardGrid: new Float64Array(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
    ),
  });
}
