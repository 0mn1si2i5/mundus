import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { KOPPEN_CLASSES } from '../../src/features/climate/koppenClasses.ts';
import { decodePngRgb } from '../../src/features/reshaped/pngCore.mjs';
import {
  classesFromRaster,
  encodeClassPng,
  landShares,
  parseLegend,
  verifyLegend,
} from './build.mjs';

const legendText = () =>
  [
    'Köppen-Geiger climate classification',
    ...KOPPEN_CLASSES.map(
      (type) =>
        `    ${type.value}:  ${type.code}   ${type.name.en}   [${type.rgb.join(' ')}]`,
    ),
    '',
  ].join('\n');

function fixtureRaster(width = 360, height = 180) {
  const values = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 100; x < 200; x += 1)
      values[y * width + x] = 1 + ((x + y) % 30);
  return values;
}

test('legend must match the reviewed Mundus classes', () => {
  const rows = parseLegend(legendText());
  assert.equal(rows.length, 30);
  assert.deepEqual(rows[13], {
    value: 14,
    code: 'Cfa',
    description: 'Humid subtropical',
    rgb: [200, 255, 80],
  });
  verifyLegend(rows, KOPPEN_CLASSES);
  const changed = rows.map((row) =>
    row.code === 'Dwa' ? { ...row, rgb: [1, 2, 3] } : row,
  );
  assert.throws(() => verifyLegend(changed, KOPPEN_CLASSES), /Dwa/);
  assert.throws(() => verifyLegend(rows.slice(1), KOPPEN_CLASSES), /29/);
});

test('raster must be a whole-globe grid of known classes', () => {
  const values = fixtureRaster();
  const raster = classesFromRaster({
    width: 360,
    height: 180,
    bbox: [-180, -90, 180, 90],
    values,
    noData: null,
  });
  assert.deepEqual(raster.grid, {
    width: 360,
    height: 180,
    west: -180,
    north: 90,
    step: 1,
  });
  assert.equal(raster.noDataCells, 0);
  assert.throws(
    () =>
      classesFromRaster({
        width: 360,
        height: 170,
        bbox: [-180, -80, 180, 90],
        values: values.subarray(0, 360 * 170),
        noData: null,
      }),
    /whole-globe/,
  );
  const invalid = values.slice();
  invalid[0] = 31;
  assert.throws(
    () =>
      classesFromRaster({
        width: 360,
        height: 180,
        bbox: [-180, -90, 180, 90],
        values: invalid,
        noData: null,
      }),
    /Unexpected Köppen-Geiger value 31/,
  );
  const withNoData = values.slice();
  withNoData[0] = 255;
  assert.equal(
    classesFromRaster({
      width: 360,
      height: 180,
      bbox: [-180, -90, 180, 90],
      values: withNoData,
      noData: 255,
    }).noDataCells,
    1,
  );
});

test('land shares weight cells by area and sum to one', () => {
  const grid = { width: 4, height: 2, west: -180, north: 90, step: 90 };
  // A whole hemisphere of class 1 and of class 2 have equal areas.
  const shares = landShares({
    grid,
    classes: Uint8Array.of(1, 1, 1, 1, 2, 2, 2, 2),
  });
  assert.equal(shares[0], 0.5);
  assert.equal(shares[1], 0.5);
  const polar = landShares({
    grid: { width: 8, height: 4, west: -180, north: 90, step: 45 },
    classes: Uint8Array.from(
      [30, 1, 1, 30].flatMap((value) => new Array(8).fill(value)),
    ),
  });
  // Bands 90–45° are much smaller than 45–0°.
  assert.ok(polar[0] > 0.7 && polar[29] < 0.3);
  assert.ok(Math.abs(polar.reduce((a, b) => a + b, 0) - 1) < 1e-5);
});

test('class PNG round-trips through the browser decoder', async () => {
  const raster = classesFromRaster({
    width: 360,
    height: 180,
    bbox: [-180, -90, 180, 90],
    values: fixtureRaster(),
    noData: null,
  });
  const png = encodeClassPng(raster);
  const decoded = await decodePngRgb(
    png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  );
  assert.equal(decoded.width, 360);
  assert.deepEqual(Uint8Array.from(decoded.ids), raster.classes);
});

test('capture reads the archive layout and refuses unpinned builds', async () => {
  const { writeArrayBuffer } = await import('geotiff');
  const directory = await mkdtemp(join(tmpdir(), 'koppen-'));
  try {
    await mkdir(join(directory, 'src', '1991_2020'), { recursive: true });
    const tif = writeArrayBuffer(fixtureRaster(), {
      width: 360,
      height: 180,
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, -180, 90, 0],
      GeographicTypeGeoKey: 4326,
      BitsPerSample: [8],
      SampleFormat: [1],
    });
    await writeFile(
      join(directory, 'src', '1991_2020', 'koppen_geiger_0p1.tif'),
      Buffer.from(tif),
    );
    await writeFile(join(directory, 'src', 'legend.txt'), legendText());
    const archive = join(directory, 'koppen_geiger_tif.zip');
    await promisify(execFile)('zip', ['-qr', archive, '.'], {
      cwd: join(directory, 'src'),
    });
    const run = (...args) =>
      promisify(execFile)(process.execPath, [
        'scripts/build-koppen-geiger.mjs',
        '--archive',
        archive,
        ...args,
      ]);
    const { stdout } = await run('--capture');
    const captured = JSON.parse(stdout);
    assert.equal(captured.member, '1991_2020/koppen_geiger_0p1.tif');
    assert.match(captured.sha256, /^[0-9a-f]{64}$/);
    assert.equal(captured.legend.length, 30);
    await assert.rejects(run(), /Pin the reviewed archive identity|differs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
