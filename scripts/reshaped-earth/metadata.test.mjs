import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeUnits, encodeValues } from './metadata.mjs';
import {
  AREA_RATIO_MAX_RELATIVE_ERROR,
  decodeUnits,
  decodeValues,
} from '../../src/features/reshaped/metadata.mjs';

const unit = (code, index, level = 'admin1') => ({
  id: level === 'country' ? 'ne-001' : `ne-001:${code}`,
  level,
  parentCountryId: 'ne-001',
  paletteIndex: index,
  name: { en: code, zh: null },
  areaKm2: 1.2345678912345678,
  representativePoint: {
    longitude: -180 + 0.5 / 120,
    latitude: 90 - 0.5 / 120,
  },
});
const classification = {
  units: [unit('one', 1), unit('two', 2), unit('three', 3)],
  countries: [unit('country', 1, 'country')],
};

test('column metadata preserves Float64 values, true zero and missing, and derives country sums', () => {
  const unitsAsset = encodeUnits(classification);
  const units = decodeUnits(unitsAsset);
  assert.equal(units[0].areaKm2, classification.units[0].areaKm2);
  assert.deepEqual(
    units[0].representativePoint,
    classification.units[0].representativePoint,
  );
  assert.equal(units[3].id, 'ne-001');
  const metric = {
    values: [null, 123456.123456789, 0, null],
    countryValues: [null, 123456.123456789],
    diagnostics: { assignedTotal: 123456.123456789 },
  };
  const field = {
    actualAreas: { 1: 2.734567, 2: 0.000123456789 },
    trueAreas: { 1: 1, 2: 1 },
  };
  const asset = encodeValues(
    classification,
    { population: metric },
    { 'population-admin1': field, 'population-country': field },
  );
  const rows = decodeValues(asset, units);
  assert.equal(rows[0].values.population, metric.values[1]);
  assert.equal(rows[1].values.population, 0);
  assert.equal(rows[2].values.population, null);
  assert.equal(rows[3].values.population, metric.countryValues[1]);
  assert.equal(rows[3].worldShare.population, 1);
  for (const i of [0, 1]) {
    const ratio = field.actualAreas[i + 1];
    assert.ok(
      Math.abs(rows[i].areaRatio.population / ratio - 1) <=
        AREA_RATIO_MAX_RELATIVE_ERROR,
    );
  }
  assert.equal(
    JSON.stringify(encodeUnits(classification)),
    JSON.stringify(unitsAsset),
  );
  assert.equal(
    JSON.stringify(
      encodeValues(
        classification,
        { population: metric },
        { 'population-admin1': field, 'population-country': field },
      ),
    ),
    JSON.stringify(asset),
  );
});

test('metadata rejects broken column lengths and out-of-range area ratios', () => {
  const asset = encodeUnits(classification);
  assert.throws(
    () => decodeUnits({ ...asset, areaKm2: '' }),
    /length mismatch/,
  );
  const metric = {
    values: [null, 1, 0, null],
    countryValues: [null, 1],
    diagnostics: { assignedTotal: 1 },
  };
  const field = { actualAreas: { 1: 1e20, 2: 1 }, trueAreas: { 1: 1, 2: 1 } };
  assert.throws(
    () =>
      encodeValues(
        classification,
        { population: metric },
        { 'population-admin1': field, 'population-country': field },
      ),
    /outside encoding range/,
  );
});
