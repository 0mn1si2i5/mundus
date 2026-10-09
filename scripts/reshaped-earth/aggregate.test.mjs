import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateCoarseValues,
  aggregateFineValues,
  aggregateParents,
  assertConservation,
} from './aggregate.mjs';

test('fine aggregation preserves zero and reports missing as null', () => {
  const result = aggregateFineValues({
    labels: [1, 1, 2, 0],
    values: [0, null, 2, 3],
    unitCount: 2,
  });
  assert.deepEqual(result.values, [0, 2]);
  assert.equal(result.unassigned, 3);
  assertConservation(result);
});

test('coarse values are apportioned by labelled sub-cell area', () => {
  const result = aggregateCoarseValues({
    coarseWidth: 2,
    coarseHeight: 1,
    subWidth: 2,
    subHeight: 2,
    labels: [1, 1, 1, 2, 2, 0, 2, 0],
    sourceValues: [100, 50],
    unitCount: 2,
  });
  // The row-major fixture gives first coarse pixel 2/3 unit 1 and second
  // coarse pixel 1/3 unit 1, for 83 1/3 and 66 2/3 respectively.
  assert.ok(Math.abs(result.values[0] - 250 / 3) < 1e-10);
  assert.ok(Math.abs(result.values[1] - 200 / 3) < 1e-10);
  assert.equal(result.unassigned, 0);
  assertConservation(result);
});

test('a coarse cell without labels goes to unassigned and nodata stays absent', () => {
  const result = aggregateCoarseValues({
    coarseWidth: 2,
    coarseHeight: 1,
    subWidth: 1,
    subHeight: 1,
    labels: [0, 1],
    sourceValues: [10, null],
    unitCount: 1,
  });
  assert.deepEqual(result.values, [null]);
  assert.equal(result.unassigned, 10);
  assertConservation(result);
});

test('parent aggregation gives country totals from admin-1 rows', () => {
  const result = aggregateParents(
    [
      { id: 'cn:1', value: 2 },
      { id: 'cn:2', value: 3 },
      { id: 'xx:1', value: null },
    ],
    (row) => row.id.split(':')[0],
  );
  assert.equal(result.get('cn'), 5);
  assert.equal(result.get('xx'), null);
});
