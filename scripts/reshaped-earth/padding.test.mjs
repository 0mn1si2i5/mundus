import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCountryPadding,
  countryBoundaryDistances,
  METRIC_BITS,
} from './padding.mjs';
import {
  iterationStopReason,
  largestCountryErrors,
} from './production-field.mjs';

function fixture(width = 32, height = 16) {
  const ids = new Uint8Array(width * height);
  for (let y = 3; y < height - 3; y += 1)
    for (let x = 5; x < width - 5; x += 1) ids[y * width + x] = 1;
  const raster = { width, height, ids };
  const countries = [
    { id: 'square', name: { en: 'Square' }, paletteIndex: 1, excluded: false },
  ];
  const map = { jacobian: () => 1 };
  let area = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (ids[y * width + x])
        area +=
          (Math.cos((y * Math.PI) / height) -
            Math.cos(((y + 1) * Math.PI) / height)) /
          (2 * width);
  return {
    raster,
    countries,
    map,
    actualAreas: new Map([[1, area]]),
    targetAreas: new Map([[1, area / 2]]),
  };
}

test('padding core is central, target accurate within final pixel, and remaining edge is hatched', () => {
  const options = fixture(),
    result = computeCountryPadding(options);
  const entry = result.summary.countries[0];
  assert.ok(entry.coreArea >= entry.targetArea);
  assert.ok(
    (entry.coreArea - entry.targetArea) / entry.targetArea <=
      entry.onePixelRelativeError + 1e-12,
  );
  assert.equal(result.effectiveAreas.get(1), entry.coreArea);
  assert.equal(result.mask[8 * 32 + 16], 0);
  assert.equal(result.mask[3 * 32 + 5], 1);
  assert.ok(entry.paddingFraction > 0.45 && entry.paddingFraction < 0.51);
  for (let i = 0; i < result.mask.length; i += 1)
    if (!options.raster.ids[i]) assert.equal(result.mask[i], 0);
});

test('annular land and a detached island have deterministic masks and areas', () => {
  const options = fixture();
  for (let y = 6; y <= 9; y += 1)
    for (let x = 13; x <= 18; x += 1) options.raster.ids[y * 32 + x] = 0;
  options.raster.ids[1 * 32 + 1] = 1;
  const a = computeCountryPadding(options),
    b = computeCountryPadding(options);
  assert.deepEqual(a.mask, b.mask);
  assert.deepEqual(a.summary, b.summary);
  assert.equal(a.mask[1 * 32 + 1], 1);
});

test('distance traverses the periodic seam continuously', () => {
  const width = 32,
    height = 16,
    ids = new Uint8Array(width * height);
  for (let y = 3; y < 13; y += 1)
    for (let x = -5; x < 5; x += 1) ids[y * width + ((x + width) % width)] = 1;
  const distance = countryBoundaryDistances({ width, height, ids });
  assert.equal(distance[8 * width], distance[8 * width + 31]);
  assert.ok(distance[8 * width] > distance[8 * width + 4]);
  assert.equal(distance[8 * width + 4], 0);
});

test('small countries skip padding and <=10% excess does not trigger it', () => {
  const options = fixture();
  options.targetAreas.set(1, options.actualAreas.get(1) / 1.1);
  assert.equal(computeCountryPadding(options).summary.countries.length, 0);
  const small = fixture();
  small.raster.ids.fill(0);
  small.raster.ids[10] = 1;
  const result = computeCountryPadding(small);
  assert.equal(result.summary.countries.length, 0);
  assert.deepEqual(result.summary.skippedCountries, [
    { id: 'square', paletteIndex: 1, pixelCount: 1 },
  ]);
  assert.ok(result.mask.every((value) => !value));
});

test('metric mask bits stay stable including unpublished GDP', () => {
  assert.deepEqual(METRIC_BITS, { population: 0, gdp: 1, co2: 2, lights: 3 });
  assert.equal(
    (1 << METRIC_BITS.population) |
      (1 << METRIC_BITS.co2) |
      (1 << METRIC_BITS.lights),
    13,
  );
});

test('round diagnostics retain signed errors for tiny countries outside acceptance threshold', () => {
  const countries = [
    { id: 'large', name: { en: 'Large' }, paletteIndex: 1 },
    { id: 'tiny', name: { en: 'Tiny' }, paletteIndex: 2 },
  ];
  const errors = largestCountryErrors(
    new Map([
      [1, 0.11],
      [2, 0.0001],
    ]),
    new Map([
      [1, 0.1],
      [2, 0.0002],
    ]),
    new Map([
      [1, 0.5],
      [2, 0.00001],
    ]),
    countries,
  );
  assert.equal(errors[0].id, 'tiny');
  assert.equal(errors[0].relativeError, -0.5);
  assert.equal(errors[0].share, 0.00001);
  assert.equal(errors[0].name, 'Tiny');
});

test('iteration stops at raw pass, three small p90 improvements, or sixteen rounds', () => {
  const row = (iteration, p90, median = 0.02) => ({
    iteration,
    areaErrors: { median, p90 },
  });
  assert.equal(iterationStopReason([row(1, 0.149)]), 'raw-pass');
  assert.equal(
    iterationStopReason([
      row(1, 0.2),
      row(2, 0.196),
      row(3, 0.192),
      row(4, 0.188),
    ]),
    'plateau',
  );
  assert.equal(
    iterationStopReason([
      row(1, 0.2),
      row(2, 0.22),
      row(3, 0.24),
      row(4, 0.26),
    ]),
    'plateau',
    'worsening is not a positive improvement',
  );
  assert.equal(
    iterationStopReason([
      row(1, 0.2),
      row(2, 0.194),
      row(3, 0.19),
      row(4, 0.186),
    ]),
    null,
  );
  assert.equal(iterationStopReason([row(16, 0.2)]), 'max-rounds');
});
