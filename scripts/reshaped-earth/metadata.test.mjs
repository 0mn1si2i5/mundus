import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countryNamesFromSource,
  encodeUnits,
  encodeValues,
} from './metadata.mjs';
import {
  decodeUnits,
  decodeValues,
} from '../../src/features/reshaped/metadata.mjs';

const countries = Array.from({ length: 4 }, (_, i) => ({
  id: `ne-${i + 1}`,
  paletteIndex: i + 1,
  name: { en: `Country ${i + 1}`, zh: null },
  areaKm2: 1.2345678912345678,
  representativePoint: { longitude: i, latitude: 20 },
  excluded: i === 3,
}));
const classification = { countries };
const names = new Map(
  countries.map((c, i) => [c.id, { en: c.name.en, zh: `国家${i + 1}` }]),
);
const metrics = Object.fromEntries(
  ['population', 'gdp', 'co2', 'lights'].map((key) => [
    key,
    {
      countryValues: [null, 123456.123456789, 0, null, 3],
      diagnostics: { assignedTotal: 123456.123456789 },
    },
  ]),
);
const fields = Object.fromEntries(
  Object.keys(metrics).map((key) => [
    key,
    {
      actualAreas: { 1: 2.734567891234, 2: 0.000123456789 },
      trueAreas: { 1: 1, 2: 1 },
    },
  ]),
);

test('country JSON preserves full precision, zero, missing, excluded and localized names', () => {
  const unitsAsset = encodeUnits(classification, names);
  const units = decodeUnits(JSON.parse(JSON.stringify(unitsAsset)));
  assert.equal(units.length, 4);
  assert.equal(units[0].areaKm2, countries[0].areaKm2);
  assert.deepEqual(
    units[0].representativePoint,
    countries[0].representativePoint,
  );
  assert.deepEqual(units[0].name, names.get(countries[0].id));
  const asset = encodeValues(classification, metrics, fields, names);
  const rows = decodeValues(JSON.parse(JSON.stringify(asset)), units);
  for (const key of Object.keys(metrics)) {
    assert.equal(rows[0].values[key], metrics[key].countryValues[1]);
    assert.equal(rows[0].worldShare[key], 1);
    assert.equal(rows[0].areaRatio[key], fields[key].actualAreas[1]);
    assert.equal(rows[1].values[key], 0);
    assert.equal(rows[1].worldShare[key], 0);
    assert.equal(rows[1].areaRatio[key], fields[key].actualAreas[2]);
    assert.equal(rows[2].values[key], null);
    assert.equal(rows[2].worldShare[key], null);
    assert.equal(rows[3].values[key], 3);
    assert.equal(rows[3].worldShare[key], null);
    assert.equal(rows[3].areaRatio[key], null);
  }
  assert.deepEqual(encodeValues(classification, metrics, fields, names), asset);
});

test('country names use exact IDs, established wording and omit merged territory overrides', () => {
  const c = [
    { id: 'ne-156', name: { en: 'China' } },
    { id: 'ne-158', name: { en: 'Taiwan' } },
    { id: 'ne-036', name: { en: 'Australia' } },
    { id: 'ne-702', name: { en: 'Singapore' } },
  ];
  const features = [
    ['CHN', 156, '中华人民共和国'],
    ['TWN', 158, '中华民国'],
    ['AUS', 36, '澳大利亚'],
    ['IOA', 36, '澳属印度洋领地'],
    ['SGP', 702, '新加坡'],
  ].map(([ADM0_A3, ISO_N3_EH, NAME_ZH]) => ({
    properties: { ADM0_A3, ISO_N3_EH, NAME_ZH },
  }));
  const localized = countryNamesFromSource(c, { features });
  assert.deepEqual(
    [...localized.values()],
    [
      { en: 'China', zh: '中国' },
      { en: 'Taiwan', zh: '台湾' },
      { en: 'Australia', zh: '澳大利亚' },
      { en: 'Singapore', zh: '新加坡' },
    ],
  );
  assert.throws(
    () => countryNamesFromSource(c, { features: features.slice(0, 4) }),
    /Missing country display name: ne-702/,
  );
});

test('padded country values use solid-core area and retain readable padding metadata', () => {
  const changed = structuredClone(fields);
  const entry = {
    id: countries[0].id,
    paletteIndex: 1,
    actualArea: 0.2,
    rasterActualArea: 0.201,
    targetArea: 0.1,
    coreArea: 0.1001,
    paddingArea: 0.0999,
    paddingFraction: 0.4995,
    onePixelRelativeError: 0.002,
  };
  changed.population.padding = { countries: [entry] };
  changed.population.effectiveAreas = {
    ...changed.population.actualAreas,
    1: entry.coreArea,
  };
  const asset = encodeValues(classification, metrics, changed, names);
  assert.equal(asset.formatVersion, 4);
  assert.equal(asset.rows[0].areaRatio.population, entry.coreArea);
  assert.deepEqual(asset.rows[0].padding.population, entry);
  assert.equal(asset.rows[1].padding.population, null);
});

test('three-field publication omits GDP values and source attribution', () => {
  const asset = encodeValues(classification, metrics, fields, names, [
    'population',
    'co2',
    'lights',
  ]);
  assert.deepEqual(asset.metrics, ['population', 'co2', 'lights']);
  assert.equal(asset.sourceIds.gdp, undefined);
  assert.equal(asset.totals.gdp, undefined);
  assert.ok(
    asset.rows.every(
      (row) => row.values.gdp === undefined && row.padding.gdp === undefined,
    ),
  );
});

test('metadata rejects old formats, administrative records, incomplete metrics and invented missing results', () => {
  const asset = encodeUnits(classification, names),
    units = decodeUnits(asset);
  assert.throws(
    () => decodeUnits({ ...asset, formatVersion: 2 }),
    /units format/,
  );
  assert.throws(
    () => decodeUnits({ ...asset, units: [{ ...units[0], level: 'admin1' }] }),
    /country/,
  );
  assert.throws(() => encodeUnits(classification), /country/);
  const values = encodeValues(classification, metrics, fields, names);
  assert.throws(
    () => decodeValues({ ...values, metrics: ['population'] }, units),
    /values format/,
  );
  const changed = structuredClone(values);
  changed.rows[2].worldShare.population = 0;
  assert.throws(() => decodeValues(changed, units), /Missing or excluded/);
});
