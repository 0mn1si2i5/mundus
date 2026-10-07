import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  geoArea,
  geoBounds,
  geoCentroid,
  geoContains,
  geoDistance,
} from 'd3-geo';
import { feature } from 'topojson-client';

const ATLAS_PATH = 'node_modules/world-atlas/countries-50m.json';
const ATLAS_URL =
  'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';
const ATLAS_SHA256 =
  '04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394';
// Test the country-scale ceiling first. Only candidates that hit a land
// collision need the bounded binary refinement, which keeps the global build
// predictable while avoiding the old single-midpoint under-sizing.
const SEARCH_STEPS = 6;
const COARSE_ENVELOPE_SAMPLES = [-1, 0, 1];
const ENVELOPE_SAMPLES = [-1, -0.5, 0, 0.5, 1];
// A surname is a cartographic label, so its baseline follows the local
// parallel by default. Only countries whose horizontal fit is starved by their
// shape (Chile, Italy, Norway, ...) are offered a straight rotated wordmark,
// and only when the rotation makes it materially larger.
const ROTATIONS = [0];
const NARROW_ROTATIONS = [-75, -60, -45, -30, -15, 15, 30, 45, 60, 75, 90];
// A country is "narrow" when its interior points spread at least this many
// times further along their principal axis than across it. Rotations are
// tried only within ROTATION_AXIS_TOLERANCE of that axis, so compact countries
// such as France always keep a horizontal wordmark.
const ELONGATION_THRESHOLD = 2;
const ROTATION_AXIS_TOLERANCE = 35;
const ROTATION_GAIN = 1.15;
const SHAPE_GRID = 24;
const RANK_STEPS = 7;
const REFINE_ROUNDS = 4;
// A label belongs near the country's visual centre (its label anchor) unless
// that costs a lot of size. Centred candidates are scored by
// fit * (1 - CENTRALITY_WEIGHT * min(1, distanceToAnchor / countryScaleCap)).
// The runtime chooser in src/features/globe/surnameLabelSlots.ts applies the
// same score, so keep the two weights equal.
const CENTRALITY_WEIGHT = 0.4;
// Rounding keeps the derived asset byte-stable across V8 builds whose libm
// differs in the last floating-point digit.
const OUTPUT_DECIMALS = 6;
const HEIGHT_RATIOS = { long: 0.28, medium: 0.5, square: 1 };
const MAX_FOOTPRINT_DEGREES = 20;
const TOP_CANDIDATES = 12;
const POLE_SAFE_COSINE = 0.12;
const POLE_SAFE_LONGITUDE_SPAN = Math.PI * 0.75;
// Evaluate a bounded deterministic subset of the 5x5 interior grid. Three
// centers retain useful alternatives without multiplying runtime candidates.
const MAX_EVALUATED_CENTERS = Number(
  process.env.SURNAME_SLOT_MAX_EVALUATED_CENTERS ?? 3,
);

const anchors = JSON.parse(
  await readFile('src/data/generated/country-label-anchors.json', 'utf8'),
).anchors;
const surnameCountries = Object.keys(
  JSON.parse(
    await readFile('src/data/generated/surnames-by-country.json', 'utf8'),
  ).countries,
);
const countryLimit = Number(process.env.SURNAME_SLOT_COUNTRY_LIMIT ?? 0);
const countryFilter = process.env.SURNAME_SLOT_COUNTRIES?.split(',');
const countriesToBuild = countryFilter
  ? surnameCountries.filter((countryId) => countryFilter.includes(countryId))
  : countryLimit > 0
    ? surnameCountries.slice(0, countryLimit)
    : surnameCountries;
const atlasBytes = await readFile(ATLAS_PATH);
const atlasSha256 = createHash('sha256').update(atlasBytes).digest('hex');
if (atlasSha256 !== ATLAS_SHA256) {
  throw new Error(
    `${ATLAS_PATH}: expected ${ATLAS_SHA256}, received ${atlasSha256}`,
  );
}
const detailedCountries = topologyFeatures(
  JSON.parse(atlasBytes.toString('utf8')),
);
const countriesById = new Map(
  detailedCountries.map((country) => [country.properties.countryId, country]),
);
const countryBounds = new Map(
  detailedCountries.map((country) => [
    country.properties.countryId,
    geoBounds(country),
  ]),
);
const countryGrid = createCountryGrid(detailedCountries);
const localClearanceCache = new Map();

const slots = {};
for (const countryId of countriesToBuild) {
  const country = countriesById.get(countryId);
  const anchor = anchors[countryId];
  if (!country || !anchor) continue;
  const areaSteradians = Math.max(0, geoArea(country));
  const equivalentRadiusDegrees =
    (Math.acos(Math.max(-1, Math.min(1, 1 - areaSteradians / (2 * Math.PI)))) *
      180) /
    Math.PI;
  const countryScaleCap = clamp(
    1.6 * equivalentRadiusDegrees,
    0.35,
    MAX_FOOTPRINT_DEGREES,
  );
  const interiorCenters = createInteriorCenters(country, anchor.point);
  // Rank every interior center by how large a long horizontal wordmark fits,
  // then move the best one toward the widest clear area. Ranking by a coarse
  // square probe tied most centers of large countries and left the evaluated
  // centers effectively arbitrary (Algeria's wordmark sat in a corner).
  const horizontal = rankCenters(
    interiorCenters,
    countryId,
    0,
    countryScaleCap,
    anchor.point,
  );
  const evaluated = horizontal
    .slice(0, countryScaleCap >= 4 ? MAX_EVALUATED_CENTERS : 3)
    .map((entry) => ({ ...entry, rotationDegrees: 0 }));
  const evaluatedKeys = new Set(
    evaluated.map(
      ({ center }) =>
        `${center.latitude.toFixed(1)}:${center.longitude.toFixed(1)}`,
    ),
  );
  for (const heightRatio of [
    HEIGHT_RATIOS.square,
    HEIGHT_RATIOS.medium,
    HEIGHT_RATIOS.long,
  ]) {
    const centred = centredCenter(
      interiorCenters,
      countryId,
      countryScaleCap,
      anchor.point,
      heightRatio,
    );
    if (!centred) continue;
    const key = `${centred.center.latitude.toFixed(1)}:${centred.center.longitude.toFixed(1)}`;
    if (evaluatedKeys.has(key)) continue;
    evaluatedKeys.add(key);
    evaluated.push({ ...centred, rotationDegrees: 0 });
  }
  const bestHorizontalFit = evaluated[0]?.fit ?? 0;
  const shape = principalAxis(country);
  if (shape.elongation >= ELONGATION_THRESHOLD) {
    const rotated = NARROW_ROTATIONS.filter(
      (rotationDegrees) =>
        lineAngleDifference(rotationDegrees, shape.axisDegrees) <=
        ROTATION_AXIS_TOLERANCE,
    )
      .map((rotationDegrees) => ({
        rotationDegrees,
        ...(rankCenters(
          interiorCenters,
          countryId,
          rotationDegrees,
          countryScaleCap,
          anchor.point,
          1,
        )[0] ?? { center: anchor.point, fit: 0 }),
      }))
      .filter(
        (entry) =>
          entry.fit >= ROTATION_GAIN * bestHorizontalFit && entry.fit > 0.05,
      )
      .sort(
        (a, b) =>
          b.fit - a.fit ||
          Math.abs(a.rotationDegrees) - Math.abs(b.rotationDegrees),
      )
      .slice(0, 2);
    evaluated.unshift(...rotated);
  }
  const candidates = [];
  for (const { center, rotationDegrees } of evaluated) {
    const localClearance = localBoundaryClearance(
      { center, rotationDegrees, countryScaleCap },
      countryId,
      COARSE_ENVELOPE_SAMPLES,
      2,
    );
    const oceanDirection = directionFrom(anchor.point, center);
    {
      const base = {
        layout: 'straight',
        center,
        rotationDegrees,
        curvature: 0,
        oceanDirection,
        countryScaleCap,
        areaSteradians,
        localClearance,
      };
      const foreignClearanceFor = (heightRatio) =>
        findMaximumRadius(
          (radius, samples) =>
            isForeignLandSafe(base, countryId, radius, heightRatio, samples),
          0.05,
          MAX_FOOTPRINT_DEGREES,
        );
      const longForeignClearance = foreignClearanceFor(HEIGHT_RATIOS.long);
      const mediumForeignClearance = foreignClearanceFor(HEIGHT_RATIOS.medium);
      const squareForeignClearance = foreignClearanceFor(HEIGHT_RATIOS.square);
      const long = solveCandidateFit(
        base,
        countryId,
        HEIGHT_RATIOS.long,
        equivalentRadiusDegrees,
        longForeignClearance,
      );
      const medium = solveCandidateFit(
        base,
        countryId,
        HEIGHT_RATIOS.medium,
        equivalentRadiusDegrees,
        mediumForeignClearance,
      );
      const square = solveCandidateFit(
        base,
        countryId,
        HEIGHT_RATIOS.square,
        equivalentRadiusDegrees,
        squareForeignClearance,
      );
      if (
        long.maxAngularDegrees <= 0.02 &&
        medium.maxAngularDegrees <= 0.02 &&
        square.maxAngularDegrees <= 0.02
      )
        continue;
      candidates.push({
        ...base,
        maxAngularDegrees: long.maxAngularDegrees,
        mediumMax: medium.maxAngularDegrees,
        squareMax: square.maxAngularDegrees,
        strictMaxAngularDegrees: long.strictMaxAngularDegrees,
        strictMediumMax: medium.strictMaxAngularDegrees,
        strictSquareMax: square.strictMaxAngularDegrees,
        neighborSafe: long.neighborSafe,
        mediumNeighborSafe: medium.neighborSafe,
        squareNeighborSafe: square.neighborSafe,
        foreignClearance: long.foreignClearance,
        mediumForeignClearance: medium.foreignClearance,
        squareForeignClearance: square.foreignClearance,
        isolatedOverflow:
          long.isolatedOverflow ||
          medium.isolatedOverflow ||
          square.isolatedOverflow,
        localClearance,
        landSafe: true,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      b.maxAngularDegrees - a.maxAngularDegrees ||
      b.mediumMax - a.mediumMax ||
      b.squareMax - a.squareMax ||
      a.center.latitude - b.center.latitude ||
      a.center.longitude - b.center.longitude,
  );
  slots[countryId] = (
    candidates.length > 0
      ? candidates
      : [
          {
            layout: 'straight',
            center: anchor.point,
            rotationDegrees: 0,
            curvature: 0,
            oceanDirection: 'none',
            countryScaleCap,
            areaSteradians,
            maxAngularDegrees: 0,
            mediumMax: 0,
            squareMax: 0,
            strictMaxAngularDegrees: 0,
            strictMediumMax: 0,
            strictSquareMax: 0,
            neighborSafe: 0,
            mediumNeighborSafe: 0,
            squareNeighborSafe: 0,
            isolatedOverflow: false,
            localClearance: 0,
            landSafe: false,
          },
        ]
  ).slice(0, TOP_CANDIDATES);
}

const output = {
  schemaVersion: 3,
  sourceName: 'Natural Earth country geometry with spherical surname envelopes',
  sourceUrl: ATLAS_URL,
  sourceSha256: ATLAS_SHA256,
  sourceAsset: 'src/data/generated/country-label-anchors.json',
  candidatePolicy: {
    maxCandidatesPerCountry: TOP_CANDIDATES,
    sourceGridCenters: 25,
    evaluatedCentersPerCountry: MAX_EVALUATED_CENTERS,
    rotations: ROTATIONS,
    heightRatios: HEIGHT_RATIOS,
    coarseEnvelopeSamples: COARSE_ENVELOPE_SAMPLES.length ** 2,
    envelopeSamples: ENVELOPE_SAMPLES.length ** 2,
    countryScaleFormula: 'clamp(1.6 * equivalentRadiusDegrees, 0.35, 20)',
    centerRanking: `all interior grid centers ranked by a ${RANK_STEPS}-step dense long-envelope fit; best center hill-climbed for ${REFINE_ROUNDS} halving rounds`,
    centredCandidates: `per wordmark shape (square, medium, long): the horizontal center maximizing fit * (1 - ${CENTRALITY_WEIGHT} * min(1, anchor distance / countryScaleCap)), hill-climbed the same way`,
    narrowRotations: NARROW_ROTATIONS,
    narrowRotationRule: `offered when interior-point principal-axis elongation >= ${ELONGATION_THRESHOLD}, within ${ROTATION_AXIS_TOLERANCE}deg of that axis; kept when >= ${ROTATION_GAIN} * the best horizontal fit`,
    numberPrecision: 'toPrecision(9)',
    isolatedOverflowFormula:
      'eligible when foreign clearance >= max(2.5 * strict fit, strict fit + max(0.75deg, 0.9 * equivalent radius)); cap=min(strict fit + 0.8 * equivalent radius, 0.75 * foreign clearance, 2.8 * equivalent radius, 20deg)',
  },
  slots: roundNumbers(slots),
};
const bytes = `${JSON.stringify(output)}\n`;
const outputPath =
  process.env.SURNAME_SLOT_OUTPUT ??
  'src/data/generated/surname-label-slots.json';
await writeFile(outputPath, bytes);
console.log(
  JSON.stringify({
    countryCount: Object.keys(slots).length,
    candidateCount: Object.values(slots).reduce(
      (sum, country) => sum + country.length,
      0,
    ),
    rawBytes: Buffer.byteLength(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }),
);

// Principal axis of a country's interior, measured in a local east/north
// plane around its centroid from a fixed grid of contained points.
function principalAxis(country) {
  const [[west, south], [east, north]] = geoBounds(country);
  const [centroidLongitude, centroidLatitude] = geoCentroid(country);
  const longitudeSpan = east >= west ? east - west : east + 360 - west;
  const cosine = Math.max(
    POLE_SAFE_COSINE,
    Math.cos((centroidLatitude * Math.PI) / 180),
  );
  const points = [];
  for (let row = 0; row < SHAPE_GRID; row += 1) {
    for (let column = 0; column < SHAPE_GRID; column += 1) {
      const latitude = south + ((row + 0.5) / SHAPE_GRID) * (north - south);
      const longitude = normalize(
        west + ((column + 0.5) / SHAPE_GRID) * longitudeSpan,
      );
      if (!geoContains(country, [longitude, latitude])) continue;
      points.push([
        normalize(longitude - centroidLongitude) * cosine,
        latitude - centroidLatitude,
      ]);
    }
  }
  if (points.length < 3) return { elongation: 1, axisDegrees: 0 };
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const [x, y] of points) {
    xx += (x - meanX) ** 2;
    xy += (x - meanX) * (y - meanY);
    yy += (y - meanY) ** 2;
  }
  const trace = xx + yy;
  const spread = Math.sqrt(((xx - yy) / 2) ** 2 + xy ** 2);
  const major = trace / 2 + spread;
  const minor = Math.max(1e-12, trace / 2 - spread);
  const axisDegrees = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI;
  return { elongation: Math.sqrt(major / minor), axisDegrees };
}

// Difference between two undirected line angles, in [0, 90] degrees.
function lineAngleDifference(a, b) {
  const difference = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(difference, 180 - difference);
}

function rankCenters(
  centers,
  countryId,
  rotationDegrees,
  countryScaleCap,
  anchor,
  limit = Number.POSITIVE_INFINITY,
) {
  const ranked = centers
    .map((center) => ({
      center,
      fit: coarseOwnFit(center, countryId, rotationDegrees, countryScaleCap),
    }))
    .sort(
      (a, b) =>
        b.fit - a.fit ||
        angularDistance(a.center, anchor) - angularDistance(b.center, anchor) ||
        a.center.latitude - b.center.latitude ||
        a.center.longitude - b.center.longitude,
    );
  if (ranked[0] && ranked[0].fit > 0) {
    ranked[0] = refineCenter(
      ranked[0],
      countryId,
      rotationDegrees,
      countryScaleCap,
    );
  }
  return ranked.slice(0, limit);
}

// Moves a center across the country toward a larger long-envelope fit. The
// search is a deterministic eight-direction hill climb with a halving step.
function refineCenter(
  start,
  countryId,
  rotationDegrees,
  countryScaleCap,
  heightRatio = HEIGHT_RATIOS.long,
  score = (candidate) => candidate.fit,
) {
  const country = countriesById.get(countryId);
  let best = start;
  let bestScore = score(start);
  let step = Math.max(0.1, start.fit * 0.5);
  for (let round = 0; round < REFINE_ROUNDS;) {
    let improved = false;
    for (const [north, east] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const latitude = clamp(best.center.latitude + north * step, -89, 89);
      const center = {
        latitude,
        longitude: normalize(
          best.center.longitude +
            (east * step) /
              Math.max(POLE_SAFE_COSINE, Math.cos((latitude * Math.PI) / 180)),
        ),
      };
      if (!geoContains(country, [center.longitude, center.latitude])) continue;
      const fit = coarseOwnFit(
        center,
        countryId,
        rotationDegrees,
        countryScaleCap,
        heightRatio,
      );
      const candidateScore = score({ center, fit });
      if (candidateScore > bestScore + 1e-6) {
        best = { center, fit };
        bestScore = candidateScore;
        improved = true;
      }
    }
    if (!improved) {
      step /= 2;
      round += 1;
    }
  }
  return best;
}

function centralityScore(fit, center, anchor, countryScaleCap) {
  const distance = (angularDistance(center, anchor) * 180) / Math.PI;
  return (
    fit *
    (1 -
      CENTRALITY_WEIGHT *
        Math.min(1, distance / Math.max(countryScaleCap, 1e-6)))
  );
}

// The best horizontal center for one wordmark shape, trading size against
// distance from the label anchor. A single CJK character needs a square
// slot, which the long-envelope ranking above does not optimize for.
function centredCenter(
  centers,
  countryId,
  countryScaleCap,
  anchor,
  heightRatio,
) {
  const score = (candidate) =>
    centralityScore(candidate.fit, candidate.center, anchor, countryScaleCap);
  const ranked = centers
    .map((center) => ({
      center,
      fit: coarseOwnFit(center, countryId, 0, countryScaleCap, heightRatio),
    }))
    .filter((candidate) => candidate.fit > 0)
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        a.center.latitude - b.center.latitude ||
        a.center.longitude - b.center.longitude,
    );
  if (!ranked[0]) return null;
  return refineCenter(
    ranked[0],
    countryId,
    0,
    countryScaleCap,
    heightRatio,
    score,
  );
}

function coarseOwnFit(
  center,
  countryId,
  rotationDegrees,
  countryScaleCap,
  heightRatio = HEIGHT_RATIOS.long,
) {
  const base = { center, rotationDegrees };
  const isAllowed = (radius) =>
    isOwnCountrySafe(
      base,
      countryId,
      radius,
      heightRatio,
      // Thin or ragged countries need the dense envelope: a 3x3 probe
      // overestimates rotated fits that cross narrow necks or bays.
      ENVELOPE_SAMPLES,
    );
  const minimum = 0.05;
  const maximum = Math.min(MAX_FOOTPRINT_DEGREES, countryScaleCap);
  if (!isAllowed(minimum)) return 0;
  if (isAllowed(maximum)) return maximum;
  let low = minimum;
  let high = maximum;
  for (let step = 0; step < RANK_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (isAllowed(middle)) low = middle;
    else high = middle;
  }
  return low;
}

function angularDistance(a, b) {
  return geoDistance([a.longitude, a.latitude], [b.longitude, b.latitude]);
}

function roundNumbers(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toPrecision(9)) : value;
  }
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, roundNumbers(entry)]),
    );
  }
  return value;
}

function createInteriorCenters(country, anchor) {
  const [[west, south], [east, north]] = geoBounds(country);
  const centers = [anchor, geoCentroid(country)];
  // A fixed 5x5 interior grid gives large countries enough room to move the
  // wordmark toward a wider clear area while remaining deterministic for
  // narrow, concave and multi-island geometries. The anchor and centroid are
  // retained as stable fallbacks when the grid misses a small polygon.
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const latitude = south + ((row + 0.5) / 5) * (north - south);
      const longitudeSpan = east >= west ? east - west : east + 360 - west;
      const longitude = west + ((column + 0.5) / 5) * longitudeSpan;
      const point = { latitude, longitude: normalize(longitude) };
      if (geoContains(country, [point.longitude, point.latitude]))
        centers.push(point);
    }
  }
  const unique = new Map();
  for (const point of centers) {
    const normalized = Array.isArray(point)
      ? { latitude: point[1], longitude: normalize(point[0]) }
      : { latitude: point.latitude, longitude: normalize(point.longitude) };
    if (
      Number.isFinite(normalized.latitude) &&
      Number.isFinite(normalized.longitude) &&
      geoContains(country, [normalized.longitude, normalized.latitude])
    ) {
      unique.set(
        `${normalized.latitude.toFixed(5)}:${normalized.longitude.toFixed(5)}`,
        normalized,
      );
    }
  }
  return [...unique.values()];
}

function directionFrom(anchor, center) {
  const latitudeDelta = center.latitude - anchor.latitude;
  const longitudeDelta = normalize(center.longitude - anchor.longitude);
  if (Math.abs(latitudeDelta) < 0.35 && Math.abs(longitudeDelta) < 0.35)
    return 'none';
  if (Math.abs(latitudeDelta) >= Math.abs(longitudeDelta))
    return latitudeDelta < 0 ? 'south' : 'north';
  return longitudeDelta < 0 ? 'west' : 'east';
}

function solveCandidateFit(
  base,
  countryId,
  heightRatio,
  equivalentRadiusDegrees,
  foreignClearance,
) {
  const minimum = 0.05;
  const maximum = Math.min(MAX_FOOTPRINT_DEGREES, base.countryScaleCap);
  const strictMaxAngularDegrees = findMaximumRadius(
    (radius, samples) =>
      isOwnCountrySafe(base, countryId, radius, heightRatio, samples),
    minimum,
    maximum,
  );
  if (strictMaxAngularDegrees <= 0) {
    return {
      maxAngularDegrees: 0,
      strictMaxAngularDegrees: 0,
      neighborSafe: 0,
      foreignClearance: 0,
      isolatedOverflow: false,
    };
  }

  const isolatedThreshold = Math.max(
    strictMaxAngularDegrees * 2.5,
    strictMaxAngularDegrees + 0.75,
    strictMaxAngularDegrees + 0.9 * equivalentRadiusDegrees,
  );
  const isolated = foreignClearance >= isolatedThreshold;
  const overflowMax = isolated
    ? Math.min(
        strictMaxAngularDegrees * 1.25 + 0.15,
        strictMaxAngularDegrees + 0.8 * equivalentRadiusDegrees,
        foreignClearance * 0.75,
        Math.max(0.35, equivalentRadiusDegrees * 2.8),
        MAX_FOOTPRINT_DEGREES,
      )
    : strictMaxAngularDegrees;
  return {
    maxAngularDegrees: Math.max(strictMaxAngularDegrees, overflowMax),
    strictMaxAngularDegrees,
    neighborSafe: Math.max(strictMaxAngularDegrees, overflowMax),
    foreignClearance,
    isolatedOverflow: isolated && overflowMax > strictMaxAngularDegrees + 1e-6,
  };
}

function findMaximumRadius(isAllowed, minimum, maximum) {
  if (!isAllowed(minimum, ENVELOPE_SAMPLES)) return 0;
  if (isAllowed(maximum, ENVELOPE_SAMPLES)) return maximum;
  let low = minimum;
  let high = maximum;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (isAllowed(middle, COARSE_ENVELOPE_SAMPLES)) low = middle;
    else high = middle;
  }
  if (isAllowed(low, ENVELOPE_SAMPLES)) return low;
  let denseLow = minimum;
  let denseHigh = low;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (denseLow + denseHigh) / 2;
    if (isAllowed(middle, ENVELOPE_SAMPLES)) denseLow = middle;
    else denseHigh = middle;
  }
  return denseLow;
}

function isOwnCountrySafe(
  base,
  countryId,
  radius,
  heightRatio,
  samples = ENVELOPE_SAMPLES,
) {
  const country = countriesById.get(countryId);
  if (
    !country ||
    !geoContains(country, [base.center.longitude, base.center.latitude])
  )
    return false;
  const envelope = sampleEnvelope(base, radius, heightRatio, samples);
  return envelope.every((point) =>
    geoContains(country, [point.longitude, point.latitude]),
  );
}

function isForeignLandSafe(
  base,
  countryId,
  radius,
  heightRatio,
  samples = ENVELOPE_SAMPLES,
) {
  const envelope = sampleEnvelope(base, radius, heightRatio, samples);
  return !potentialCountries(envelope).some((candidate) => {
    if (candidate.properties.countryId === countryId) return false;
    return envelope.some((point) =>
      geoContains(candidate, [point.longitude, point.latitude]),
    );
  });
}

function localBoundaryClearance(
  base,
  countryId,
  samples = ENVELOPE_SAMPLES,
  searchSteps = 5,
) {
  const cacheKey = `${countryId}:${base.center.latitude.toFixed(5)}:${base.center.longitude.toFixed(5)}:${base.rotationDegrees}:${samples.length}:${searchSteps}`;
  const cached = localClearanceCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const country = countriesById.get(countryId);
  if (!country) return 0;
  let low = 0;
  let high = Math.min(12, base.countryScaleCap);
  for (let step = 0; step < searchSteps; step += 1) {
    const middle = (low + high) / 2;
    const points = sampleEnvelope(base, middle, 1, samples);
    if (
      points.every((point) =>
        geoContains(country, [point.longitude, point.latitude]),
      )
    )
      low = middle;
    else high = middle;
  }
  localClearanceCache.set(cacheKey, low);
  return low;
}

function sampleEnvelope(
  base,
  radiusDegrees,
  heightRatio,
  samples = ENVELOPE_SAMPLES,
) {
  const radius = (Math.max(0.005, radiusDegrees) * Math.PI) / 180;
  const halfWidth = radius / Math.sqrt(1 + heightRatio ** 2);
  const halfHeight = halfWidth * heightRatio;
  const rotation = (base.rotationDegrees * Math.PI) / 180;
  const center = geoVector(base.center);
  const latitude = (base.center.latitude * Math.PI) / 180;
  const longitude = (base.center.longitude * Math.PI) / 180;
  const east = { x: Math.cos(longitude), y: 0, z: -Math.sin(longitude) };
  const north = {
    x: -Math.sin(latitude) * Math.sin(longitude),
    y: Math.cos(latitude),
    z: -Math.sin(latitude) * Math.cos(longitude),
  };
  const rotatedEast = add(
    scale(east, Math.cos(rotation)),
    scale(north, Math.sin(rotation)),
  );
  const rotatedNorth = add(
    scale(north, Math.cos(rotation)),
    scale(east, -Math.sin(rotation)),
  );
  const followsLatitude = Math.abs(base.rotationDegrees) < 1e-8;
  const points = [];
  for (const along of samples) {
    for (const across of samples) {
      if (followsLatitude) {
        const rowLatitude = Math.max(
          -Math.PI / 2 + 1e-5,
          Math.min(Math.PI / 2 - 1e-5, latitude + across * halfHeight),
        );
        const safeCosine = Math.max(
          Math.abs(Math.cos(rowLatitude)),
          POLE_SAFE_COSINE,
        );
        const longitudeOffset = Math.max(
          -POLE_SAFE_LONGITUDE_SPAN,
          Math.min(POLE_SAFE_LONGITUDE_SPAN, (along * halfWidth) / safeCosine),
        );
        points.push({
          latitude: (rowLatitude * 180) / Math.PI,
          longitude: normalize(((longitude + longitudeOffset) * 180) / Math.PI),
        });
        continue;
      }
      const tangent = add(
        scale(rotatedEast, along * halfWidth),
        scale(rotatedNorth, across * halfHeight),
      );
      const length = Math.hypot(tangent.x, tangent.y, tangent.z);
      const surface =
        length < 1e-8
          ? center
          : add(
              scale(center, Math.cos(length)),
              scale(normalizeVector(tangent), Math.sin(length)),
            );
      points.push(vectorGeo(surface));
    }
  }
  return points;
}

function geoVector(point) {
  const latitude = (point.latitude * Math.PI) / 180;
  const longitude = (point.longitude * Math.PI) / 180;
  return {
    x: Math.cos(latitude) * Math.sin(longitude),
    y: Math.sin(latitude),
    z: Math.cos(latitude) * Math.cos(longitude),
  };
}
function vectorGeo(vector) {
  return {
    latitude: (Math.asin(vector.y) * 180) / Math.PI,
    longitude: normalize((Math.atan2(vector.x, vector.z) * 180) / Math.PI),
  };
}
function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(a, factor) {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}
function normalizeVector(value) {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return scale(value, 1 / length);
}
function bboxIntersectsSamples(bounds, samples) {
  const [[west, south], [east, north]] = bounds;
  return samples.some((point) => {
    if (point.latitude < south || point.latitude > north) return false;
    return west <= east
      ? point.longitude >= west && point.longitude <= east
      : point.longitude >= west || point.longitude <= east;
  });
}
function createCountryGrid(countries) {
  const grid = new Map();
  for (const country of countries) {
    const bounds = countryBounds.get(country.properties.countryId);
    if (!bounds) continue;
    const [[west, south], [east, north]] = bounds;
    const minLat = Math.floor(
      (Math.max(-90, south - MAX_FOOTPRINT_DEGREES) + 90) / 10,
    );
    const maxLat = Math.floor(
      (Math.min(90, north + MAX_FOOTPRINT_DEGREES) + 90) / 10,
    );
    const longitudeRanges =
      west <= east
        ? [[west - MAX_FOOTPRINT_DEGREES, east + MAX_FOOTPRINT_DEGREES]]
        : [
            [west - MAX_FOOTPRINT_DEGREES, 180],
            [-180, east + MAX_FOOTPRINT_DEGREES],
          ];
    for (let lat = minLat; lat <= maxLat; lat += 1) {
      for (const [rangeWest, rangeEast] of longitudeRanges) {
        const minLon = Math.floor((Math.max(-180, rangeWest) + 180) / 10);
        const maxLon = Math.floor((Math.min(180, rangeEast) + 180) / 10);
        for (let lon = minLon; lon <= maxLon; lon += 1) {
          const key = `${lat}:${lon}`;
          const bucket = grid.get(key) ?? [];
          bucket.push(country);
          grid.set(key, bucket);
        }
      }
    }
  }
  return grid;
}
function potentialCountries(samples) {
  const candidates = new Map();
  for (const point of samples) {
    const lat = Math.floor((point.latitude + 90) / 10);
    const lon = Math.floor((point.longitude + 180) / 10);
    for (const country of countryGrid.get(`${lat}:${lon}`) ?? []) {
      candidates.set(country.properties.countryId, country);
    }
  }
  return [...candidates.values()];
}
function topologyFeatures(topology) {
  const merged = new Map();
  for (const country of feature(topology, topology.objects.countries)
    .features) {
    const countryId = countryIdFor(country.id, country.properties.name);
    const normalized = {
      ...country,
      properties: { ...country.properties, countryId },
    };
    const existing = merged.get(countryId);
    if (!existing) {
      merged.set(countryId, normalized);
      continue;
    }
    existing.geometry = {
      type: 'MultiPolygon',
      coordinates: [
        ...asPolygons(existing.geometry),
        ...asPolygons(normalized.geometry),
      ],
    };
  }
  return [...merged.values()];
}
function asPolygons(geometry) {
  return geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];
}
function countryIdFor(sourceId, sourceName) {
  if (sourceId !== undefined && sourceId !== null)
    return `ne-${String(sourceId).padStart(3, '0')}`;
  const exception = {
    'N. Cyprus': 'ne-x-northern-cyprus',
    Somaliland: 'ne-x-somaliland',
    Kosovo: 'ne-x-kosovo',
    'Indian Ocean Ter.': 'ne-x-indian-ocean-territories',
    'Siachen Glacier': 'ne-x-siachen-glacier',
  }[sourceName];
  if (!exception)
    throw new Error(`Missing countryId mapping for ${sourceName}`);
  return exception;
}
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
function normalize(value) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}
