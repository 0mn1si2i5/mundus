import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import {
  DETAILS,
  LOW_DETAIL_COUNTRY_IDS,
  MANIFEST_PATH,
  mundusCountryFeatures,
} from './build-mundus-countries.mjs';

// Clockwise, as d3-geo and Natural Earth exterior rings expect.
const square = (west, south, size) => [
  [
    [west, south],
    [west, south + size],
    [west + size, south + size],
    [west + size, south],
    [west, south],
  ],
];

function unit(a3, numeric, name, polygons) {
  return {
    type: 'Feature',
    properties: { ADM0_A3: a3, ISO_N3_EH: numeric, NAME: name },
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  };
}

test('separates Taiwan from the China view and merges listed dependencies', () => {
  const chn = {
    features: [
      unit('CHN', '156', 'China (view name)', [
        square(100, 30, 5),
        square(120.5, 22.5, 1),
      ]),
      unit('SCR', '-99', 'Scarborough Reef', [square(117.7, 15.1, 0.1)]),
      unit('AUS', '036', 'Australia', [square(130, -30, 5)]),
      unit('IOA', '036', 'Indian Ocean Ter.', [square(105.5, -10.5, 0.2)]),
      unit('BRT', '-99', 'Bir Tawil', [square(33.5, 21.7, 0.3)]),
    ],
  };
  const fallback = {
    features: [
      unit('CHN', '156', 'China', [square(100, 30, 5)]),
      unit('TWN', '158', 'Taiwan', [square(120.5, 22.5, 1)]),
      unit('AUS', '036', 'Australia', [square(130, -30, 5)]),
    ],
  };
  const features = mundusCountryFeatures(chn, fallback);
  assert.deepEqual(
    features.map((f) => [f.properties.countryId, f.properties.name]),
    [
      ['ne-036', 'Australia'],
      ['ne-156', 'China'],
      ['ne-158', 'Taiwan'],
      ['ne-x-bir-tawil', 'Bir Tawil'],
    ],
  );
  const china = features.find((f) => f.id === 'ne-156');
  const australia = features.find((f) => f.id === 'ne-036');
  assert.equal(china.geometry.coordinates.length, 2);
  assert.equal(australia.geometry.coordinates.length, 2);
});

test('rejects a China view that already separates Taiwan', () => {
  const taiwan = unit('TWN', '158', 'Taiwan', [square(120.5, 22.5, 1)]);
  assert.throws(
    () => mundusCountryFeatures({ features: [taiwan] }, { features: [taiwan] }),
    /unexpectedly contains a Taiwan unit/,
  );
});

test('committed topologies match the manifest and keep every unit', async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  for (const [detail, options] of Object.entries(DETAILS)) {
    const record = manifest.topologyAssets[detail];
    assert.equal(record.path, options.path);
    const bytes = await readFile(record.path);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      record.sha256,
    );
    const topology = JSON.parse(bytes.toString('utf8'));
    const countries = feature(topology, topology.objects.countries).features;
    const ids = countries.map((country) => country.properties.countryId);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, record.countries);
    if (detail === '110m') {
      assert.deepEqual(new Set(ids), LOW_DETAIL_COUNTRY_IDS);
    } else {
      assert.equal(ids.length, 239);
    }
    assert.deepEqual(
      ids.filter((id) => !/^ne-\d{3}$/.test(id)),
      detail === '110m' ? [] : ['ne-x-bir-tawil'],
    );
    for (const country of countries) {
      const area = geoArea(country);
      assert.ok(
        area > 0 && area < 2 * Math.PI,
        `${detail} ${country.properties.countryId} area ${area}`,
      );
    }
  }
});
