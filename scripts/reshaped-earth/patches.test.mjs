import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeRgbPng } from './png.mjs';
import {
  assertPatchBoundsDisjoint,
  buildPatchAtlas,
  circularBounds,
  clusterPatchGroups,
  clusterPatchPolygons,
  makePatch,
  orderPatchRemovals,
  patchBoundsForFeature,
  selectPatchCountries,
  PATCH_TRANSITION_WIDTH,
} from './patches.mjs';

const rect = (west, south, east, north) => [
  [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ],
];
const feature = (id, west, south, east, north) => ({
  id,
  geometry: { type: 'Polygon', coordinates: rect(west, south, east, north) },
});
const multiFeature = (id, polygons) => ({
  id,
  geometry: { type: 'MultiPolygon', coordinates: polygons },
});
const emptyBase = () => ({
  width: 4096,
  height: 2048,
  ids: new Uint8Array(4096 * 2048),
  padding: new Uint8Array(4096 * 2048),
});
function optionsFor(countryFeatures) {
  return {
    classification: {
      countries: countryFeatures.map((country, index) => ({
        id: country.id,
        paletteIndex: index + 1,
        areaKm2: 100,
        excluded: false,
      })),
    },
    fields: Object.fromEntries(
      ['population', 'gdp', 'co2', 'lights'].map((metric) => [
        metric,
        {
          trueAreas: [0, ...countryFeatures.map(() => 1)],
          effectiveAreas: [0, ...countryFeatures.map(() => 20)],
        },
      ]),
    ),
    publishedMetrics: ['population'],
    countryFeatures,
    baseRaster: emptyBase(),
  };
}

test('patch selection is deterministic and uses only published area ratios', () => {
  const classification = {
    countries: [
      { id: 'a', paletteIndex: 1, areaKm2: 100, excluded: false },
      { id: 'b', paletteIndex: 2, areaKm2: 20_000, excluded: false },
      { id: 'c', paletteIndex: 3, areaKm2: 99, excluded: false },
    ],
  };
  const fields = Object.fromEntries(
    ['population', 'gdp', 'co2', 'lights'].map((metric) => [
      metric,
      {
        trueAreas: [0, 1, 1, 1],
        effectiveAreas: [0, metric === 'co2' ? 11 : 1, 100, 9],
      },
    ]),
  );
  assert.deepEqual(selectPatchCountries({ classification, fields }), [
    {
      countryId: 'a',
      rasterId: 1,
      areaKm2: 100,
      maxAreaRatio: 11,
      areaRatios: { population: 1, gdp: 1, co2: 11, lights: 1 },
    },
  ]);
  assert.deepEqual(
    selectPatchCountries({
      classification,
      fields,
      publishedMetrics: ['population'],
    }),
    [],
  );
});

test('4c margin uses original span and preserves four pixels inside the transition', () => {
  const country = feature('a', 0, 0, 0.01, 0.02);
  const raw = circularBounds(country),
    bounds = patchBoundsForFeature(country);
  const threeBasePixels = (3 * 360) / 4096;
  assert.ok(Math.abs(raw.west - bounds.west - threeBasePixels) < 1e-10);
  assert.ok(Math.abs(bounds.north - raw.north - threeBasePixels) < 1e-10);
  const [group] = clusterPatchPolygons(country);
  const patch = makePatch({
    group,
    allFeatures: [country],
    labelsById: new Map([['a', 1]]),
    base: emptyBase(),
  });
  assert.ok(patch.edgeClearancePixels >= PATCH_TRANSITION_WIDTH + 4);
  assert.ok(patch.width < 60 && patch.height < 60);
});

test('multi-island clustering merges nearby islands and keeps remote islands separate', () => {
  const country = multiFeature('a', [
    rect(0, 0, 0.1, 0.1),
    rect(0.12, 0, 0.22, 0.1),
    rect(20, 0, 20.1, 0.1),
  ]);
  const first = clusterPatchPolygons(country),
    second = clusterPatchPolygons(country);
  assert.deepEqual(
    first.map((group) => group.polygonIndices),
    [[0, 1], [2]],
  );
  assert.deepEqual(first, second);
  assertPatchBoundsDisjoint(first);
});

test('global clustering merges nearby countries and leaves remote countries disjoint', () => {
  const countryFeatures = [
    feature('a', 0, 0, 0.1, 0.1),
    feature('b', 0.2, 0, 0.3, 0.1),
    feature('c', 20, 0, 20.1, 0.1),
  ];
  const selection = optionsFor(countryFeatures).classification.countries.map(
    (country) => ({
      countryId: country.id,
      rasterId: country.paletteIndex,
    }),
  );
  const groups = clusterPatchGroups({ selection, countryFeatures });
  assert.deepEqual(
    groups.map((group) => group.countryIds),
    [['a', 'b'], ['c']],
  );
  assert.deepEqual(
    groups.map((group) => group.rasterIds),
    [[1, 2], [3]],
  );
  assertPatchBoundsDisjoint(groups);
  assert.throws(
    () =>
      assertPatchBoundsDisjoint([
        { bbox: [0, 0, 1, 1] },
        { bbox: [0.5, 0, 1.5, 1] },
      ]),
    /S9: overlapping patch groups/,
  );
});

test('multi-country clustering handles the antimeridian and is input-order independent', () => {
  const countryFeatures = [
    feature('b', -180, -0.1, -179.8, 0.1),
    feature('a', 179.8, -0.1, 180, 0.1),
    feature('c', -150, -0.1, -149.8, 0.1),
  ];
  const selection = [
    { countryId: 'a', rasterId: 1 },
    { countryId: 'b', rasterId: 2 },
    { countryId: 'c', rasterId: 3 },
  ];
  const first = clusterPatchGroups({ selection, countryFeatures });
  const second = clusterPatchGroups({
    selection: [...selection].reverse(),
    countryFeatures: [...countryFeatures].reverse(),
  });
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((group) => group.countryIds),
    [['a', 'b'], ['c']],
  );
  assert.ok(first[0].bounds.east - first[0].bounds.west < 2);
  assertPatchBoundsDisjoint(first);
  assert.throws(
    () =>
      assertPatchBoundsDisjoint([
        { bbox: [179, 0, 181, 1] },
        { bbox: [-180, 0, -179, 1] },
      ]),
    /overlapping/,
  );
});

test('group envelopes are repeatedly merged when an earlier merge meets another box', () => {
  const countryFeatures = [
    feature('a', 0, 0, 0.1, 3),
    feature('b', 0, 0, 3, 0.1),
    feature('c', 2.5, 2.5, 2.6, 2.6),
  ];
  const selection = countryFeatures.map((country, index) => ({
    countryId: country.id,
    rasterId: index + 1,
  }));
  const groups = clusterPatchGroups({ selection, countryFeatures });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].countryIds, ['a', 'b', 'c']);
});

test('multi-island multi-country atlas builds twice with identical bytes and metadata', async () => {
  const options = optionsFor([
    multiFeature('a', [
      rect(0, 0, 0.1, 0.1),
      rect(0.12, 0, 0.22, 0.1),
      rect(20, 0, 20.1, 0.1),
    ]),
    feature('b', 0.25, 0, 0.35, 0.1),
    feature('c', -20, 0, -19.9, 0.1),
  ]);
  const progress = [];
  const first = await buildPatchAtlas({
    ...options,
    onProgress: (value) => progress.push(value),
  });
  const second = await buildPatchAtlas(options);
  assert.deepEqual(first.png, second.png);
  assert.deepEqual(first.entries, second.entries);
  assert.deepEqual(first.selection, second.selection);
  assert.deepEqual(first.budgetSteps, second.budgetSteps);
  assert.equal(first.entries.length, 3);
  assert.ok(first.entries.some((entry) => entry.countryIds.length === 2));
  assertPatchBoundsDisjoint(first.entries);
  assert.ok(progress.some((value) => value.patchRow));
  assert.ok(progress.some((value) => value.patchBudget));
  for (const entry of first.entries) {
    assert.equal(entry.blockWidth, entry.width);
    assert.equal(entry.blockHeight, entry.height);
    assert.equal(entry.transitionWidthPixels, PATCH_TRANSITION_WIDTH);
    assert.ok(entry.edgeClearancePixels >= PATCH_TRANSITION_WIDTH + 4);
  }
  const decoded = decodeRgbPng(first.png);
  const largest = first.entries[0];
  const at = (x, y) =>
    decoded.data.subarray(
      ((largest.atlas.y + y) * decoded.width + largest.atlas.x + x) * 3,
      ((largest.atlas.y + y) * decoded.width + largest.atlas.x + x) * 3 + 3,
    );
  assert.deepEqual(at(0, 0), at(1, 1));
  assert.deepEqual(
    at(largest.width - 1, largest.height - 1),
    at(largest.width - 2, largest.height - 2),
  );
});

test('vector distance index preserves square distances on land and ocean', () => {
  const country = feature('a', 0, 0, 0.2, 0.2);
  const [group] = clusterPatchPolygons(country);
  const patch = makePatch({
    group,
    allFeatures: [country],
    labelsById: new Map([['a', 1]]),
    base: emptyBase(),
  });
  const dx = (patch.bbox[2] - patch.bbox[0]) / patch.innerWidth;
  const dy = (patch.bbox[3] - patch.bbox[1]) / patch.innerHeight;
  let checkedLand = 0,
    checkedOcean = 0;
  for (let y = 0; y < patch.innerHeight; y += 1)
    for (let x = 0; x < patch.innerWidth; x += 1) {
      const lon = patch.bbox[0] + (x + 0.5) * dx,
        lat = patch.bbox[3] - (y + 0.5) * dy;
      const land = lon > 0 && lon < 0.2 && lat > 0 && lat < 0.2;
      const cos = Math.cos((lat * Math.PI) / 180);
      const cx = Math.min(0.2, Math.max(0, lon)),
        cy = Math.min(0.2, Math.max(0, lat));
      const expected = land
        ? Math.min(
            (lon * cos) / dx,
            ((0.2 - lon) * cos) / dx,
            lat / dy,
            (0.2 - lat) / dy,
          )
        : Math.hypot(((lon - cx) * cos) / dx, (lat - cy) / dy);
      const offset = ((y + 1) * patch.width + x + 1) * 3;
      assert.equal(patch.pixels[offset], land ? 1 : 0);
      assert.ok(
        Math.abs((patch.pixels[offset + 2] * 4) / 255 - Math.min(4, expected)) <
          0.15,
      );
      if (expected < 4) land ? (checkedLand += 1) : (checkedOcean += 1);
    }
  assert.ok(checkedLand > 0 && checkedOcean > 0);
  assert.ok(
    patch.diagnostics.distanceSegmentChecks < patch.diagnostics.pixels * 4,
  );
});

test('vector distance index preserves circular coast distances within 0.15 pixels', () => {
  const radius = 0.1;
  const ring = Array.from({ length: 361 }, (_, index) => {
    const angle = (index * Math.PI) / 180;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  const country = {
    id: 'a',
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
  const [group] = clusterPatchPolygons(country);
  const patch = makePatch({
    group,
    allFeatures: [country],
    labelsById: new Map([['a', 1]]),
    base: emptyBase(),
  });
  const dx = (patch.bbox[2] - patch.bbox[0]) / patch.innerWidth;
  const dy = (patch.bbox[3] - patch.bbox[1]) / patch.innerHeight;
  for (let y = 0; y < patch.innerHeight; y += 1)
    for (let x = 0; x < patch.innerWidth; x += 1) {
      const lon = patch.bbox[0] + (x + 0.5) * dx;
      const lat = patch.bbox[3] - (y + 0.5) * dy;
      const radialDistance = Math.hypot(lon, lat);
      const expected = Math.min(4, Math.abs(radialDistance - radius) / dx);
      const offset = ((y + 1) * patch.width + x + 1) * 3;
      assert.ok(
        Math.abs((patch.pixels[offset + 2] * 4) / 255 - expected) < 0.15,
      );
      if (Math.abs(radialDistance - radius) > 0.00001)
        assert.equal(patch.pixels[offset], radialDistance < radius ? 1 : 0);
    }
});

test('ocean distances include a neighbouring coast just outside the local rectangle', () => {
  const country = feature('a', 0, 0, 0.1, 0.1);
  const [group] = clusterPatchPolygons(country);
  const coastWest = group.bounds.east + 0.01;
  const neighbour = feature('b', coastWest, 0, coastWest + 0.1, 0.1);
  const patch = makePatch({
    group,
    allFeatures: [country, neighbour],
    labelsById: new Map([
      ['a', 1],
      ['b', 2],
    ]),
    base: emptyBase(),
  });
  const dx = (patch.bbox[2] - patch.bbox[0]) / patch.innerWidth;
  const dy = (patch.bbox[3] - patch.bbox[1]) / patch.innerHeight;
  const y = Math.floor((patch.bbox[3] - 0.05) / dy);
  const lat = patch.bbox[3] - (y + 0.5) * dy;
  const longitude = patch.bbox[2] - 0.5 * dx;
  const expected =
    ((coastWest - longitude) * Math.cos((lat * Math.PI) / 180)) / dx;
  const offset = ((y + 1) * patch.width + patch.innerWidth) * 3;
  assert.equal(patch.pixels[offset], 0);
  assert.ok(Math.abs((patch.pixels[offset + 2] * 4) / 255 - expected) < 0.15);
});

test('hard clearance stops when a polar clamp cannot contain the vector distance guard', () => {
  const country = feature('a', 0, 89.99, 0.1, 90);
  const [group] = clusterPatchPolygons(country);
  assert.throws(
    () =>
      makePatch({
        group,
        allFeatures: [country],
        labelsById: new Map([['a', 1]]),
        base: emptyBase(),
      }),
    /S9:.*do not fit inside transition band/,
  );
});

test('padding belongs to the matching country and national evidence covers the full raster', async () => {
  const country = feature('a', 0, 0, 0.1, 0.1);
  const options = optionsFor([country, feature('b', 10, 0, 10.1, 0.1)]);
  options.baseRaster.ids.fill(2);
  options.baseRaster.padding.fill(4);
  options.baseRaster.ids[0] = 1;
  options.baseRaster.padding[0] = 2;
  const result = await buildPatchAtlas(options);
  assert.equal(result.selection[0].basePixelCount, 1);
  assert.equal(result.selection[0].basePaddingBits, 2);
  const decoded = decodeRgbPng(result.png);
  for (let i = 0; i < decoded.data.length; i += 3)
    if (decoded.data[i] !== 2) assert.equal(decoded.data[i + 1], 0);
});

test('removal order uses descending base pixels then ascending country id', () => {
  const ordered = orderPatchRemovals([
    { countryId: 'z', basePixelCount: 100 },
    { countryId: 'b', basePixelCount: 10 },
    { countryId: 'a', basePixelCount: 10 },
    { countryId: 'c', basePixelCount: 0 },
  ]);
  assert.deepEqual(
    ordered.map((country) => country.countryId),
    ['z', 'a', 'b', 'c'],
  );
});

test('budget trimming re-clusters deterministically and records every measured step', async () => {
  const options = optionsFor([
    feature('z', 20, 0, 22, 2),
    feature('a', 0, 0, 0.1, 0.1),
  ]);
  options.baseRaster.ids.fill(1, 0, 100);
  options.baseRaster.ids[100] = 2;
  const full = await buildPatchAtlas(options);
  const retainedOptions = {
    ...options,
    classification: {
      countries: options.classification.countries.map((country) => ({
        ...country,
        excluded: country.id === 'z',
      })),
    },
  };
  const retained = await buildPatchAtlas(retainedOptions);
  assert.ok(retained.gzipBytes < full.gzipBytes);
  const gzipLimit = Math.floor((retained.gzipBytes + full.gzipBytes) / 2);
  const first = await buildPatchAtlas({ ...options, gzipLimit });
  const second = await buildPatchAtlas({ ...options, gzipLimit });
  assert.deepEqual(
    first.removals.map((entry) => entry.countryId),
    ['z'],
  );
  assert.equal(first.removals[0].gzipBytesBefore, full.gzipBytes);
  assert.deepEqual(
    first.budgetSteps.map((step) => step.removedCountryId),
    [null, 'z'],
  );
  assert.equal(first.budgetSteps.at(-1).gzipBytes, retained.gzipBytes);
  assert.deepEqual(
    first.retainedSelection.map((entry) => entry.countryId),
    ['a'],
  );
  assert.deepEqual(first.png, second.png);
  assert.deepEqual(first.entries, second.entries);
  assert.deepEqual(first.removals, second.removals);
  assert.deepEqual(first.budgetSteps, second.budgetSteps);
  assert.ok(first.diagnostics.reusedBlocks > 0);
});

test('budget trimming stops before removing a core country and attaches evidence', async () => {
  const options = optionsFor([feature('ne-344', 0, 0, 0.1, 0.1)]);
  await assert.rejects(
    buildPatchAtlas({ ...options, gzipLimit: 0 }),
    (error) => {
      assert.match(error.message, /S9:.*core country ne-344/);
      assert.equal(error.report.nextRemoval.countryId, 'ne-344');
      assert.equal(error.report.budgetSteps.length, 1);
      assert.deepEqual(error.report.removals, []);
      return true;
    },
  );
});

test('64-block limit is checked after clustering, rather than on country selection', async () => {
  const overlapping = Array.from({ length: 65 }, (_, index) =>
    feature(`a-${index}`, 0, 0, 0.01, 0.01),
  );
  const accepted = await buildPatchAtlas(optionsFor(overlapping));
  assert.equal(accepted.selection.length, 65);
  assert.equal(accepted.entries.length, 1);
  const remote = Array.from({ length: 65 }, (_, index) => {
    const x = -170 + (index % 33) * 10,
      y = Math.floor(index / 33) * 10;
    return feature(`a-${index}`, x, y, x + 0.01, y + 0.01);
  });
  await assert.rejects(
    buildPatchAtlas(optionsFor(remote)),
    /S9: reshaped ID patch count 65\/64/,
  );
});
