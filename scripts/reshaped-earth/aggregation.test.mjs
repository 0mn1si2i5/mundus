import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCountryTotals } from './aggregation.mjs';
const countries = [1, 2, 3].map((paletteIndex) => ({
  id: `c${paletteIndex}`,
  paletteIndex,
}));
test('fresh country values retain zero and missing and compare every country', () => {
  assert.deepEqual(
    compareCountryTotals(
      'gdp',
      [null, 1e12, 0, null],
      [null, 1e12, 0, null],
      countries,
    ),
    { countriesCompared: 3, maximumRelativeError: 0 },
  );
  assert.throws(
    () =>
      compareCountryTotals(
        'gdp',
        [null, 1e12, 1e-30, null],
        [null, 1e12, 0, null],
        countries,
      ),
    /S8/,
  );
});
test('country comparison rejects missing transitions, nonfinite values and significant drift', () => {
  for (const values of [
    [null, 1e12 + 2000, 0, null],
    [null, 1e12, null, null],
    [null, Infinity, 0, null],
  ])
    assert.throws(
      () =>
        compareCountryTotals('co2', values, [null, 1e12, 0, null], countries),
      /S8/,
    );
});
