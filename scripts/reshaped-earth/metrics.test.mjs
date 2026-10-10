import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  aggregateMetric,
  geographicGridFromTags,
  openGeoTiffReader,
  selectYearBand,
  sumMonthlyCo2Slice,
} from './metrics.mjs';

const run = promisify(execFile);
const countries = [
  { id: 'ne-001', level: 'country', paletteIndex: 1 },
  { id: 'ne-002', level: 'country', paletteIndex: 2 },
];
const units = [
  {
    id: 'ne-001:A',
    level: 'admin1',
    parentCountryId: 'ne-001',
    paletteIndex: 1,
  },
  {
    id: 'ne-001:B',
    level: 'admin1',
    parentCountryId: 'ne-001',
    paletteIndex: 2,
  },
  {
    id: 'ne-002:C',
    level: 'admin1',
    parentCountryId: 'ne-002',
    paletteIndex: 3,
  },
];
const parents = Uint16Array.from([0, 1, 1, 2]);

async function fixture(t, labels) {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-metric-test-'));
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
  const buffer = Buffer.alloc(labels.length * 2);
  labels.forEach((label, i) => buffer.writeUInt16LE(label, i * 2));
  await writeFile(labelPath, buffer);
  return labelPath;
}

function reader(width, height, values, bounds, metadata = {}) {
  return {
    width,
    height,
    bounds,
    metadata,
    async *rows() {
      for (let row = 0; row < height; row += 1)
        yield { row, values: values.slice(row * width, (row + 1) * width) };
    },
  };
}

test('GDP sample selection uses the unique 2020 description and rejects ambiguous metadata', () => {
  assert.equal(selectYearBand(['2019', '2020', '2021']), 1);
  assert.equal(selectYearBand(['GDP year 2020', 'GDP year 2021']), 0);
  assert.throws(() => selectYearBand(['2019', '2021']), /found 0/);
  assert.throws(() => selectYearBand(['2020', 'year 2020']), /found 2/);
  assert.throws(() => selectYearBand(['20201']), /found 0/);
});

test('published endpoint/shifted geographic pixel edges retain their affine centres', () => {
  const grid = geographicGridFromTags({
    width: 43202,
    height: 21384,
    tiepoint: [0, 0, 0, -180.00791593130032, 89.0995831776456, 0],
    pixelScale: [0.00833333330032682, 0.008333333299795073, 0],
  });
  assert.equal(grid.west, -180.00791593130032);
  assert.equal(grid.dx, 0.00833333330032682);
  assert.throws(
    () =>
      geographicGridFromTags({
        width: 43200,
        height: 21600,
        tiepoint: [0, 0, 0, -181, 90, 0],
        pixelScale: [1 / 120, 1 / 120, 0],
      }),
    /bounds/,
  );
});

test('GeoTIFF affine tags preserve both signed axes and nonzero tiepoint indices', () => {
  const transform = [-1, 0, 0, 3, 0, 1, 0, -1, 0, 0, 1, 0, 0, 0, 0, 1];
  const reversed = geographicGridFromTags({
    width: 6,
    height: 2,
    transformation: transform,
  });
  assert.deepEqual(reversed.bounds, [-3, -1, 3, 1]);
  assert.equal(reversed.rx, -1);
  assert.equal(reversed.ry, 1);
  const tied = geographicGridFromTags({
    width: 6,
    height: 2,
    tiepoint: [2, 1, 0, -1, 0, 0],
    pixelScale: [1, 1, 0],
  });
  assert.deepEqual(tied.bounds, [-3, -1, 3, 1]);
  assert.deepEqual(tied.affine, [-3, 1, 0, 1, 0, -1]);
  const point = geographicGridFromTags({
    width: 6,
    height: 2,
    tiepoint: [0, 0, 0, -2.5, 0.5, 0],
    pixelScale: [1, 1, 0],
    rasterPixelIsPoint: true,
  });
  assert.deepEqual(point.bounds, [-3, -1, 3, 1]);
  assert.throws(
    () =>
      geographicGridFromTags({
        width: 6,
        height: 2,
        transformation: transform.map((value, i) => (i === 1 ? 0.1 : value)),
      }),
    /reprojection/,
  );
});

test('GeoTIFF reader selects a described sample inside one IFD and normalizes reversed axes', async (t) => {
  const { writeArrayBuffer } = await import('geotiff');
  const labelPath = await fixture(t, []);
  const path = labelPath.replace('labels.u16', 'samples.tif');
  const data = writeArrayBuffer(
    Uint16Array.from([101, 1, 102, 2, 103, 3, 104, 4]),
    {
      width: 2,
      height: 2,
      GeographicTypeGeoKey: 4326,
      GTRasterTypeGeoKey: 1,
      ModelTransformation: [-1, 0, 0, 1, 0, 1, 0, -1, 0, 0, 1, 0, 0, 0, 0, 1],
      // The bundled writer omits GDAL_METADATA's field type. It can emit the
      // same ASCII payload as ImageDescription; rename that tag below.
      ImageDescription:
        '<GDALMetadata>' +
        '<Item name="DESCRIPTION" sample="0" role="description">GDP 2019</Item>' +
        '<Item name="DESCRIPTION" sample="1" role="description">GDP 2020</Item>' +
        '<Item name="SCALE" sample="1" role="scale">2</Item>' +
        '<Item name="OFFSET" sample="1" role="offset">3</Item>' +
        '</GDALMetadata>\0',
    },
  );
  const buffer = Buffer.from(data);
  const little = buffer.toString('ascii', 0, 2) === 'II';
  const read16 = (at) =>
    little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at);
  const ifd = little ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
  let replaced = false;
  for (let entry = 0; entry < read16(ifd); entry += 1) {
    const at = ifd + 2 + entry * 12;
    if (read16(at) !== 270) continue;
    if (little) buffer.writeUInt16LE(42112, at);
    else buffer.writeUInt16BE(42112, at);
    replaced = true;
  }
  assert.ok(replaced, 'ASCII metadata fixture tag must be present');
  await writeFile(path, buffer);
  const source = await openGeoTiffReader(path, { key: 'gdp', stripeRows: 1 });
  try {
    assert.equal(source.metadata.imageIndex, 0);
    assert.equal(source.metadata.sampleIndex, 1);
    assert.equal(source.metadata.scale, 2);
    assert.equal(source.metadata.offset, 3);
    assert.deepEqual(source.bounds, [-1, -1, 1, 1]);
    const rows = [];
    for await (const row of source.rows()) rows.push(Array.from(row.values));
    assert.deepEqual(rows, [
      [4, 3],
      [2, 1],
    ]);
  } finally {
    await source.close();
  }
});

test('fine aggregation preserves zero versus nodata and forms countries only from children', async (t) => {
  const labelPath = await fixture(t, [1, 1, 2, 2, 3, 3]);
  const bounds = [-3, -1, 3, 1];
  const result = await aggregateMetric({
    key: 'population',
    labelPath,
    width: 6,
    height: 1,
    bounds,
    units,
    countries,
    adminToCountryIndex: parents,
    oceanRadius: 0,
    reader: reader(6, 1, [0, -200, 2, 3, -200, -200], bounds, { nodata: -200 }),
  });
  assert.deepEqual(result.values, [null, 0, 5, null]);
  assert.deepEqual(result.countryValues, [null, 5, null]);
  assert.equal(result.diagnostics.validTotal, 5);
  assert.equal(result.diagnostics.nodataCells, 3);
  assert.equal(result.diagnostics.relativeError, 0);
  assert.equal(result.metadata.countryAggregation, 'sum-of-admin1-children');
});

test('population coastline search uses a two-pixel halo across row and periodic seams', async (t) => {
  const width = 5;
  const height = 5;
  const labels = Array(width * height).fill(0);
  labels[2 * width + 4] = 1;
  const values = Array(width * height).fill(0);
  values[2 * width] = 10; // Across the longitude seam, one pixel away.
  values[width + 4] = 20; // One row above the labelled shore.
  values[4] = 30; // Two rows above the shore.
  values[3 * width + 2] = 40; // Beyond radius two, diagonal distance sqrt(5).
  const labelPath = await fixture(t, labels);
  const result = await aggregateMetric({
    key: 'population',
    labelPath,
    width,
    height,
    units,
    countries,
    adminToCountryIndex: parents,
    reader: reader(width, height, values, [-180, -90, 180, 90]),
  });
  assert.equal(result.values[1], 60);
  assert.equal(result.diagnostics.unassigned, 40);
  assert.equal(result.diagnostics.validTotal, 100);
  assert.equal(result.diagnostics.relativeError, 0);
  assert.ok(result.diagnostics.maximumLabelRowsBuffered <= 5);
});

test('shifted fine grid maps each source sample by its geographic centre', async (t) => {
  const bounds = [-3, -1, 3, 1];
  const labelPath = await fixture(t, [1, 2, 3, 0, 0, 0]);
  const result = await aggregateMetric({
    key: 'population',
    labelPath,
    width: 6,
    height: 1,
    bounds,
    units,
    countries,
    adminToCountryIndex: parents,
    oceanRadius: 0,
    reader: reader(3, 1, [10, 20, 30], [-2.5, -1, 0.5, 1]),
  });
  assert.equal(result.metadata.alignment, 'pixel-centre-map');
  assert.deepEqual(result.values, [null, null, 10, 20]);
  assert.equal(result.diagnostics.unassigned, 30);
});

test('GDP coarse-cell shares use spherical latitude area, and no labels means unassigned', async (t) => {
  const width = 4;
  const height = 2;
  const bounds = [-2, 0, 2, 60];
  const labelPath = await fixture(t, [1, 1, 0, 0, 2, 2, 0, 0]);
  const result = await aggregateMetric({
    key: 'gdp',
    labelPath,
    width,
    height,
    bounds,
    units,
    countries,
    adminToCountryIndex: parents,
    reader: reader(2, 1, [100, 50], bounds),
  });
  const northernShare =
    (Math.sin(Math.PI / 3) - Math.sin(Math.PI / 6)) / Math.sin(Math.PI / 3);
  assert.ok(Math.abs(result.values[1] - 100 * northernShare) < 1e-10);
  assert.ok(Math.abs(result.values[2] - 100 * (1 - northernShare)) < 1e-10);
  assert.equal(result.countryValues[1], result.values[1] + result.values[2]);
  assert.equal(result.diagnostics.unassigned, 50);
  assert.ok(result.diagnostics.relativeError < 1e-9);
  assert.equal(result.metadata.unit, '2021 international dollars (PPP)');
});

test('lights DN are summed directly over cropped source bounds without coastal reassignment', async (t) => {
  const labelPath = await fixture(t, [0, 0, 1, 2, 3, 0]);
  const result = await aggregateMetric({
    key: 'lights',
    labelPath,
    width: 2,
    height: 3,
    bounds: [-1, -1.5, 1, 1.5],
    units,
    countries,
    adminToCountryIndex: parents,
    reader: reader(2, 1, [5, 6], [-1, -0.5, 1, 0.5]),
  });
  assert.deepEqual(result.values, [null, 5, 6, null]);
  assert.deepEqual(result.countryValues, [null, 11, null]);
  assert.equal(result.metadata.coastalRadius, 0);
  assert.equal(result.diagnostics.unassigned, 0);
});

test('excluded units stay null and excluded source mass remains explicit in conservation', async (t) => {
  const labelPath = await fixture(t, [1, 2]);
  const result = await aggregateMetric({
    key: 'gdp',
    labelPath,
    width: 2,
    height: 1,
    bounds: [-1, -1, 1, 1],
    units: units.map((unit) => ({
      ...unit,
      excluded: unit.paletteIndex === 2,
    })),
    countries,
    adminToCountryIndex: parents,
    reader: reader(2, 1, [8, 9], [-1, -1, 1, 1]),
  });
  assert.equal(result.values[1], 8);
  assert.equal(result.values[2], null);
  assert.equal(result.diagnostics.excludedTotal, 9);
  assert.equal(result.diagnostics.unassigned, 9);
  assert.equal(result.diagnostics.relativeError, 0);
});

test('source rows, parent mappings, invalid DN and CO2 latitude ordering fail visibly', async (t) => {
  const labelPath = await fixture(t, [1]);
  const options = {
    key: 'lights',
    labelPath,
    width: 1,
    height: 1,
    units,
    countries,
    adminToCountryIndex: parents,
  };
  await assert.rejects(
    aggregateMetric({
      ...options,
      reader: reader(1, 1, [64], [-180, -90, 180, 90]),
    }),
    /Invalid lights value/,
  );
  await assert.rejects(
    aggregateMetric({
      ...options,
      adminToCountryIndex: [0],
      reader: reader(1, 1, [2], [-180, -90, 180, 90]),
    }),
    /lacks a parent/,
  );
  assert.deepEqual(
    Array.from(
      sumMonthlyCo2Slice({
        slices: [Float64Array.from([1000, 2000, 3000, 4000])],
        width: 2,
        rows: 2,
        months: 1,
      }),
    ),
    [3, 4, 1, 2],
  );
  assert.throws(
    () =>
      sumMonthlyCo2Slice({
        slices: [Float64Array.from([1, -1])],
        width: 2,
        rows: 1,
        months: 1,
      }),
    /Invalid CO2 value/,
  );
});
