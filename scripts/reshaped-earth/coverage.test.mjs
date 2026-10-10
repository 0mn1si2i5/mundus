import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { cartogramFromForwardGrid } from './cartogram.mjs';
import {
  buildCoverage,
  computeCoveredUnitAreas,
  densityFromCoverage,
  loadCoverage,
  rectangleTriangleAreas,
  saveCoverage,
} from './coverage.mjs';

const run = promisify(execFile);

async function fixture(t, labels) {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-coverage-test-'));
  t.after(async () => {
    try {
      await run('/usr/bin/trash', [directory]);
    } catch (error) {
      t.diagnostic(
        `Trash failed; retained fixture ${directory}: ${error.message}`,
      );
    }
  });
  const labelPath = join(directory, 'labels.u16');
  const bytes = Buffer.alloc(labels.length * 2);
  labels.forEach((label, i) => bytes.writeUInt16LE(label, i * 2));
  await writeFile(labelPath, bytes);
  return labelPath;
}

function near(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} differs from ${expected}`,
  );
}

function identity(width, height) {
  const forwardGrid = new Float64Array((width + 1) * (height + 1) * 2);
  for (let y = 0; y <= height; y += 1)
    for (let x = 0; x <= width; x += 1) {
      const i = 2 * (y * (width + 1) + x);
      forwardGrid[i] = x / width;
      forwardGrid[i + 1] = y / height;
    }
  return cartogramFromForwardGrid({ width, height, forwardGrid });
}

function triangleEntries(coverage, triangle) {
  const chunk = coverage.chunks.find(
    (entry) =>
      entry.startTriangle <= triangle &&
      triangle < entry.startTriangle + entry.offsets.length - 1,
  );
  const local = triangle - chunk.startTriangle;
  const weights = new Map();
  for (let i = chunk.offsets[local]; i < chunk.offsets[local + 1]; i += 1)
    weights.set(chunk.labels[i], chunk.weights[i]);
  return weights;
}

test('rectangle/triangle integration handles diagonal intersections exactly', () => {
  assert.deepEqual(rectangleTriangleAreas(0, 0, 1, 1), [0.5, 0.5]);
  assert.deepEqual(rectangleTriangleAreas(0.5, 0, 1, 0.5), [0.25, 0]);
  assert.deepEqual(rectangleTriangleAreas(0, 0.5, 0.5, 1), [0, 0.25]);
  const [first, second] = rectangleTriangleAreas(0.2, 0.1, 0.8, 0.6);
  near(first, 0.22);
  near(second, 0.08);
});

test('fine labels retain both mesh triangles rather than a centre label', async (t) => {
  const labelPath = await fixture(t, [1, 2, 3, 4]);
  const coverage = await buildCoverage({
    labelPath,
    width: 2,
    height: 2,
    gridWidth: 1,
    gridHeight: 1,
  });
  const first = triangleEntries(coverage, 0);
  const second = triangleEntries(coverage, 1);
  assert.deepEqual([...first.keys()], [2, 3, 4]);
  assert.deepEqual([...second.keys()], [1, 2, 3]);
  near(first.get(2), 0.125);
  near(first.get(3), 0.125);
  near(first.get(4), 0.25);
  near(second.get(1), 0.25);
  near(second.get(2), 0.125);
  near(second.get(3), 0.125);
  near(coverage.unitAreas[0], 0);
  for (const area of coverage.unitAreas.subarray(1)) near(area, 0.25);
  near(coverage.diagnostics.totalArea, 1);
});

test('identity integration uses sin(latitude) areas across nonmatching grid edges', async (t) => {
  const labelPath = await fixture(
    t,
    [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3],
  );
  const coverage = await buildCoverage({
    labelPath,
    width: 5,
    height: 3,
    gridWidth: 7,
    gridHeight: 5,
  });
  const areas = computeCoveredUnitAreas(identity(7, 5), coverage);
  near(areas.get(1), 0.25);
  near(areas.get(2), 0.5);
  near(areas.get(3), 0.25);
  near(
    [...areas.values()].reduce((sum, area) => sum + area, 0),
    1,
  );
  assert.equal(areas.has(0), false);
  for (let triangle = 0; triangle < 70; triangle += 1)
    near(
      [...triangleEntries(coverage, triangle).values()].reduce(
        (sum, value) => sum + value,
        0,
      ),
      1 / 70,
    );
});

test('real mapped areas integrate nonuniform triangle Jacobians and country parents', async (t) => {
  const labelPath = await fixture(t, [1, 1, 2, 2, 3, 3, 4, 4]);
  const coverage = await buildCoverage({
    labelPath,
    width: 4,
    height: 2,
    gridWidth: 2,
    gridHeight: 1,
  });
  const map = cartogramFromForwardGrid({
    width: 2,
    height: 1,
    forwardGrid: Float64Array.from([0, 0, 0.25, 0, 1, 0, 0, 1, 0.75, 1, 1, 1]),
  });
  const areas = computeCoveredUnitAreas(map, coverage);
  near(areas.get(1), 0.3125);
  near(areas.get(2), 0.1875);
  near(areas.get(3), 0.1875);
  near(areas.get(4), 0.3125);
  const countryAreas = computeCoveredUnitAreas(map, coverage, {
    parent: Uint16Array.from([0, 1, 1, 2, 2]),
  });
  near(countryAreas.get(1), 0.5);
  near(countryAreas.get(2), 0.5);
  assert.throws(
    () => computeCoveredUnitAreas(identity(1, 1), coverage),
    /dimensions differ/,
  );
  assert.throws(
    () => computeCoveredUnitAreas(map, coverage, { parent: [0, 1] }),
    /missing parent/,
  );
  const folded = {
    ...map,
    forwardGrid: Float64Array.from([0, 0, 0.25, 0, 1, 0, 0, -1, 0.75, 1, 1, 1]),
  };
  assert.throws(
    () => computeCoveredUnitAreas(folded, coverage),
    /non-positive/,
  );
});

test('cropped label bounds fill only their genuine uncovered world area with ocean', async (t) => {
  const labelPath = await fixture(t, [7]);
  const coverage = await buildCoverage({
    labelPath,
    width: 1,
    height: 1,
    bounds: [-90, -30, 90, 30],
    gridWidth: 5,
    gridHeight: 3,
  });
  near(coverage.unitAreas[7], 0.25);
  near(coverage.unitAreas[0], 0.75);
  near(coverage.diagnostics.uncoveredOceanArea, 0.75);
  const areas = computeCoveredUnitAreas(identity(5, 3), coverage);
  near(areas.get(7), 0.25);
  near(areas.get(0), 0.75);
});

test('striping does not change deterministic CSR bytes or seam coverage', async (t) => {
  const labels = Array.from({ length: 7 * 9 }, (_, i) =>
    i % 7 === 0 || i % 7 === 6 ? 2 : Math.floor(i / 7) < 4 ? 1 : 0,
  );
  const labelPath = await fixture(t, labels);
  const progress = [];
  const options = {
    labelPath,
    width: 7,
    height: 9,
    gridWidth: 5,
    gridHeight: 4,
  };
  const one = await buildCoverage({
    ...options,
    stripeRows: 1,
    onProgress: (state) => progress.push(state),
  });
  const three = await buildCoverage({ ...options, stripeRows: 3 });
  assert.deepEqual(one, three);
  near(one.unitAreas[2], 2 / 7);
  assert.equal(progress.at(-1).rowsCompleted, 9);
  assert.equal(progress.at(-1).meshRowsCompleted, 4);
  assert.ok(
    one.chunks.every(
      (chunk) =>
        chunk.offsets instanceof Uint32Array &&
        chunk.labels instanceof Uint16Array &&
        chunk.weights instanceof Float64Array,
    ),
  );
  await assert.rejects(
    buildCoverage({
      ...options,
      onProgress: () => {
        throw new Error('resource guard');
      },
    }),
    /resource guard/,
  );
});

test('density conserves weighted mass and distinguishes zero, missing and excluded units', async (t) => {
  const labelPath = await fixture(t, [0, 1, 2, 3, 4]);
  const coverage = await buildCoverage({
    labelPath,
    width: 5,
    height: 1,
    gridWidth: 2,
    gridHeight: 1,
  });
  const units = [1, 2, 3, 4].map((paletteIndex) => ({
    id: `admin-${paletteIndex}`,
    paletteIndex,
    excluded: paletteIndex === 4,
  }));
  const field = densityFromCoverage(coverage, {
    units,
    values: [null, 10, 0, null, 1000],
    level: 'admin1',
  });
  near(field.totalValue, 10);
  near(field.meanDensity, 25);
  near(field.densityIntegral, 25.05);
  near(field.normalizedMean, 1);
  near(field.unitDensities[1], 50);
  near(field.unitDensities[2], 0.25);
  near(field.unitDensities[3], 25);
  near(field.unitDensities[4], 25);
  near(field.shares.get(1), 1);
  assert.equal(field.shares.get(2), 0);
  assert.equal(field.shares.get(3), null);
  assert.equal(field.shares.get(4), null);
  assert.deepEqual([...field.acceptanceTargetAreas.keys()], [1, 2]);
  near(field.diagnostics.includedArea, 0.4);
  near(field.diagnostics.missingArea, 0.2);
  near(field.diagnostics.excludedArea, 0.2);
  near(field.diagnostics.zeroFloorAddedMass, 0.05);
  near(field.diagnostics.meanDensityAreaRatio, 25 / 25.05);
  near(field.areaRatios.get(2), 0.25 / 25.05);
  near(
    [...field.targetAreas.values()].reduce((sum, area) => sum + area, 0),
    1,
  );
  near(field.density[0], (0.2 * 25 + 0.2 * 50 + 0.1 * 0.25) / (0.5 * 25.05));
  assert.throws(
    () =>
      densityFromCoverage(coverage, {
        units,
        values: [null, 0, 0, null, 0],
        level: 'admin1',
      }),
    /positive included/,
  );
  assert.throws(
    () =>
      densityFromCoverage(coverage, {
        units,
        values: [null, -1, 0],
        level: 'admin1',
      }),
    /invalid metric/,
  );
  assert.throws(
    () =>
      densityFromCoverage(coverage, {
        units: units.slice(1),
        values: [],
        level: 'admin1',
      }),
    /unknown coverage label/,
  );
});

test('country fields reuse admin pieces and aggregate true areas before density', async (t) => {
  const labelPath = await fixture(t, [0, 1, 2, 3, 4]);
  const coverage = await buildCoverage({
    labelPath,
    width: 5,
    height: 1,
    gridWidth: 3,
    gridHeight: 2,
  });
  const units = [1, 2, 3, 4].map((paletteIndex) => ({
    id: `a${paletteIndex}`,
    paletteIndex,
  }));
  const countries = [1, 2, 3].map((paletteIndex) => ({
    id: `c${paletteIndex}`,
    paletteIndex,
    excluded: paletteIndex === 3,
  }));
  const field = densityFromCoverage(coverage, {
    units,
    countries,
    adminToCountryIndex: [0, 1, 1, 2, 3],
    countryValues: [null, 10, null, 100],
    level: 'country',
  });
  near(field.trueAreas.get(1), 0.4);
  near(field.trueAreas.get(2), 0.2);
  near(field.trueAreas.get(3), 0.2);
  near(field.meanDensity, 25);
  for (const value of field.density) near(value, 1);
  near(field.shares.get(1), 1);
  near(field.normalizedMean, 1);
  assert.throws(
    () =>
      densityFromCoverage(coverage, {
        units,
        countries,
        countryValues: [],
        level: 'country',
      }),
    /adminToCountryIndex/,
  );
});

test('coverage cache roundtrips typed chunks and rejects truncation or invalid version', async (t) => {
  const labelPath = await fixture(t, [1, 2, 0, 3]);
  const coverage = await buildCoverage({
    labelPath,
    width: 2,
    height: 2,
    gridWidth: 3,
    gridHeight: 2,
  });
  const cachePath = join(dirname(labelPath), 'coverage.bin');
  await saveCoverage(cachePath, coverage);
  const loaded = await loadCoverage(cachePath);
  assert.deepEqual(loaded, coverage);
  assert.deepEqual(loaded.chunks, coverage.chunks);
  assert.deepEqual(loaded.unitAreas, coverage.unitAreas);
  assert.deepEqual(
    densityFromCoverage(loaded, {
      units: [1, 2, 3].map((paletteIndex) => ({
        id: String(paletteIndex),
        paletteIndex,
      })),
      values: [null, 1, 2, 3],
      level: 'admin1',
    }).density,
    densityFromCoverage(coverage, {
      units: [1, 2, 3].map((paletteIndex) => ({
        id: String(paletteIndex),
        paletteIndex,
      })),
      values: [null, 1, 2, 3],
      level: 'admin1',
    }).density,
  );
  const bytes = await readFile(cachePath);
  await writeFile(cachePath, bytes.subarray(0, bytes.length - 1));
  await assert.rejects(loadCoverage(cachePath), /truncated/);
  // A corrupt entry count must fail before it could allocate a giant array.
  const oversized = Buffer.from(bytes);
  const chunkHeader =
    12 + oversized.readUInt32LE(8) + coverage.unitAreas.byteLength;
  oversized.writeUInt32LE(2 ** 32 - 1, chunkHeader + 8);
  await writeFile(cachePath, oversized);
  await assert.rejects(loadCoverage(cachePath), /CSR dimensions/);
  bytes[0] = 0;
  await writeFile(cachePath, bytes);
  await assert.rejects(loadCoverage(cachePath), /magic\/version/);
});
