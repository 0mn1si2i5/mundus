import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  buildUnits,
  cellAreaKm2,
  rasterizeFeatures,
  readLabelStripes,
  resolveClassification,
} from './units.mjs';

const run = promisify(execFile);

function ring(west, south, east, north) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

function country(id, coordinates) {
  return {
    type: 'Feature',
    id,
    properties: { countryId: id, name: id },
    geometry: { type: 'Polygon', coordinates },
  };
}

function admin(code, adm0, coordinates, nameZh = '测试名称') {
  return {
    type: 'Feature',
    properties: { adm1_code: code, adm0_a3: adm0, name: code, name_zh: nameZh },
    geometry: { type: 'Polygon', coordinates },
  };
}

function metadata(id) {
  return { id, name: { en: id } };
}

test('scanline even/odd fill preserves holes regardless of ring winding', () => {
  const feature = country('ne-001', [ring(-4, -4, 4, 4), ring(-2, -2, 2, 2)]);
  const options = { width: 10, height: 10, bounds: [-5, -5, 5, 5] };
  const { labels, overlapPixels } = rasterizeFeatures([feature], options);
  assert.equal(labels.filter(Boolean).length, 48);
  assert.equal(overlapPixels, 0);
  for (let y = 3; y < 7; y += 1)
    for (let x = 3; x < 7; x += 1) assert.equal(labels[y * 10 + x], 0);
  feature.geometry.coordinates[1].reverse();
  assert.deepEqual(rasterizeFeatures([feature], options).labels, labels);
});

test('antimeridian polygon is unfolded and covers both periodic edges', () => {
  const feature = country('ne-001', [
    [
      [179, -1],
      [-179, -1],
      [-179, 1],
      [179, 1],
      [179, -1],
    ],
  ]);
  const { labels } = rasterizeFeatures([feature], { width: 360, height: 180 });
  assert.equal(labels.filter(Boolean).length, 4);
  assert.equal(labels[89 * 360], 1);
  assert.equal(labels[89 * 360 + 359], 1);
  assert.equal(labels[90 * 360], 1);
  assert.equal(labels[90 * 360 + 359], 1);
});

test('spherical pixel areas cover 4πR² and decrease toward poles', () => {
  const width = 360;
  const height = 180;
  let area = 0;
  for (let y = 0; y < height; y += 1)
    area += width * cellAreaKm2(y, { width, height });
  const target = 4 * Math.PI * 6371.0088 ** 2;
  assert.ok(Math.abs(area / target - 1) < 1e-12);
  assert.ok(
    cellAreaKm2(0, { width, height }) < cellAreaKm2(89, { width, height }),
  );
});

test('classification retains direct units, transfers at 95%, merges remnants by edge, and falls back by country', () => {
  const countries = [
    metadata('ne-001'),
    metadata('ne-002'),
    metadata('ne-003'),
  ];
  const admins = [
    admin('A', 'ONE', []),
    admin('B', 'TWO', []),
    admin('C', 'TWO', []),
    admin('D', 'ONE', []),
  ];
  const stride = admins.length + 1;
  const pair = (c, a) => c * stride + a;
  const pairAreas = new Map([
    [pair(1, 1), 10],
    [pair(1, 2), 95],
    [pair(2, 2), 5],
    [pair(1, 3), 20],
    [pair(2, 3), 80],
    [pair(1, 4), 30],
    [pair(3, 0), 3],
  ]);
  const adjacency = new Map([
    [
      pair(1, 3),
      new Map([
        [pair(1, 1), 8],
        [pair(1, 4), 3],
      ]),
    ],
  ]);
  const result = resolveClassification({
    countries,
    adminFeatures: admins,
    originalParents: Uint16Array.from([0, 1, 2, 2, 1]),
    pairAreas,
    adminAreas: Float64Array.from([0, 10, 100, 100, 30]),
    adjacency,
  });
  const unitFor = (c, a) => result.units[result.pairLabels.get(pair(c, a)) - 1];
  assert.equal(unitFor(1, 1).id, 'ne-001:A');
  assert.equal(unitFor(1, 2).id, 'ne-001:B');
  assert.equal(unitFor(1, 3).id, 'ne-001:A');
  assert.equal(unitFor(3, 0).id, 'ne-003:ADM0');
  assert.equal(unitFor(3, 0).wholeCountryFallback, true);
  assert.equal(result.finalParents[2], 1);
  assert.equal(result.finalParents[3], 2);
  const transfer = result.boundaryAdjustments.find(
    (entry) => entry.type === 'transfer',
  );
  assert.equal(transfer.coverageFraction, 0.95);
  assert.equal(transfer.areaKm2, 95);
  const remnant = result.boundaryAdjustments.find(
    (entry) => entry.admin1Id === 'C',
  );
  assert.equal(remnant.destinationUnitId, 'ne-001:A');
  assert.equal(remnant.sharedEdgeCount, 8);
  assert.equal(remnant.needsReview, true);
});

test('zero-edge remnant tie stays in country and picks covered area then stable code', () => {
  const countries = [metadata('ne-001')];
  const admins = [
    admin('A', 'ONE', []),
    admin('B', 'ONE', []),
    admin('C', 'OTHER', []),
  ];
  const stride = 4;
  const pairAreas = new Map([
    [stride + 1, 10],
    [stride + 2, 20],
    [stride + 3, 4],
  ]);
  const result = resolveClassification({
    countries,
    adminFeatures: admins,
    originalParents: Uint16Array.from([0, 1, 1, 0]),
    pairAreas,
    adminAreas: Float64Array.from([0, 10, 20, 100]),
    adjacency: new Map(),
  });
  const remnant = result.boundaryAdjustments.find(
    (entry) => entry.type === 'remnant',
  );
  assert.equal(remnant.destinationUnitId, 'ne-001:B');
  assert.equal(remnant.reason, 'zero-edge-tie');
  assert.equal(remnant.sharedEdgeCount, 0);
  pairAreas.set(stride + 1, 20);
  const tied = resolveClassification({
    countries,
    adminFeatures: admins,
    originalParents: Uint16Array.from([0, 1, 1, 0]),
    pairAreas,
    adminAreas: Float64Array.from([0, 20, 20, 100]),
    adjacency: new Map(),
  });
  assert.equal(
    tied.boundaryAdjustments.find((entry) => entry.type === 'remnant')
      .destinationUnitId,
    'ne-001:A',
  );
});

test('full build writes streamed labels and picks the thickest point in the largest component', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'mundus-units-test-'));
  t.after(async () => {
    try {
      await run('/usr/bin/trash', [cacheDir]);
    } catch {
      /* Retain the fixture if Trash is unavailable. */
    }
  });
  const large = ring(-18, -10, -4, 10);
  const small = ring(6, -4, 14, 4);
  const c = country('ne-001', [large]);
  c.geometry = { type: 'MultiPolygon', coordinates: [[large], [small]] };
  const a = admin('ONE-1', 'ONE', [large]);
  a.geometry = c.geometry;
  const result = await buildUnits({
    cacheDir,
    countries: [c],
    admin1: { features: [a] },
    a3CountryIds: { ONE: 'ne-001' },
    width: 40,
    height: 40,
    bounds: [-20, -20, 20, 20],
  });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].rasterPixelCount, 344);
  assert.equal(result.units[0].name.zh, '测试名称');
  assert.equal(result.nameCoverage.fraction, 1);
  const point = result.units[0].representativePoint;
  assert.ok(point.longitude > -18 && point.longitude < -4);
  assert.ok(point.latitude > -10 && point.latitude < 10);
  assert.equal(result.units[0].representativeBoundaryDistancePixels, 6);
  assert.ok(
    result.units[0].largestComponentAreaKm2 > result.units[0].areaKm2 / 2,
  );
  assert.deepEqual(result.countries[0].representativePoint, point);
  assert.equal((await stat(result.labelPath)).size, 40 * 40 * 2);
  const bytes = await readFile(result.labelPath);
  assert.equal(bytes.readUInt16LE((20 * 40 + 9) * 2), 1);
  let count = 0;
  for await (const stripe of readLabelStripes(result.labelPath, {
    width: 40,
    height: 40,
    stripeRows: 7,
  }))
    count += stripe.labels.filter(Boolean).length;
  assert.equal(count, 344);
  assert.deepEqual(result.boundaryAdjustments, []);
});

test('whole-country fallback, excluded Antarctica and missing Chinese S5 are explicit', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'mundus-units-missing-test-'));
  t.after(async () => {
    try {
      await run('/usr/bin/trash', [cacheDir]);
    } catch {
      /* Retain the fixture if Trash is unavailable. */
    }
  });
  const c = country('ne-010', [ring(-4, -4, 4, 4)]);
  const result = await buildUnits({
    cacheDir,
    countries: [c],
    admin1: { features: [] },
    width: 10,
    height: 10,
    bounds: [-5, -5, 5, 5],
  });
  assert.equal(result.units[0].id, 'ne-010:ADM0');
  assert.equal(result.units[0].excluded, true);
  assert.equal(result.countries[0].excluded, true);
  assert.equal(result.units[0].name.zh, null);
  await assert.rejects(
    buildUnits({
      cacheDir,
      countries: [c],
      admin1: { features: [admin('CHN-1', 'CHN', [ring(-4, -4, 4, 4)], null)] },
      width: 10,
      height: 10,
      bounds: [-5, -5, 5, 5],
    }),
    /S5.*CHN-1/,
  );
});

test('country overlaps remain gated and label-reader detects truncation', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'mundus-units-overlap-test-'));
  t.after(async () => {
    try {
      await run('/usr/bin/trash', [cacheDir]);
    } catch {
      /* Retain the fixture if Trash is unavailable. */
    }
  });
  const feature = country('ne-001', [ring(-4, -4, 4, 4)]);
  await assert.rejects(
    buildUnits({
      cacheDir,
      countries: [feature, country('ne-002', [ring(-3, -3, 3, 3)])],
      admin1: { features: [] },
      width: 10,
      height: 10,
      bounds: [-5, -5, 5, 5],
    }),
    /overlap area fraction/,
  );
  await assert.rejects(
    buildUnits({
      cacheDir,
      countries: [feature],
      admin1: { features: [] },
      width: 10,
      height: 10,
      overlapTolerance: 1e-3,
    }),
    /must not exceed/,
  );
});
