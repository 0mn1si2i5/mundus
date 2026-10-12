import assert from 'node:assert/strict';
import test from 'node:test';
import {
  centreThresholds,
  solveOwnership,
  createWorkspace,
} from './solver.mjs';

test('chosen optimal routes report inherited unknown-country cells without changing ownership or thresholds', () => {
  const graph = {
    size: 3,
    land: new Uint8Array([1, 1, 1]),
    unknownLand: new Uint8Array([0, 1, 0]),
    neighbours(cell, visit) {
      if (cell > 0) visit(cell - 1, 1);
      if (cell < 2) visit(cell + 1, 1);
    },
  };
  const cities = [
    {
      id: 12,
      ownerIndex: 1,
      population: 100_000,
      sourceCells: [0],
      centreCell: 0,
    },
    {
      id: 23,
      ownerIndex: 2,
      population: 1_000_000,
      sourceCells: [2],
      centreCell: 2,
    },
  ];
  const workspace = createWorkspace(graph.size);
  const result = solveOwnership(graph, cities, 0, workspace);
  assert.deepEqual([...result.owners], [1, 2, 2]);
  assert.deepEqual([...result.unknownPaths], [0, 1, 0]);
  const thresholds = centreThresholds(graph, cities, workspace);
  assert.equal(thresholds.get(12).threshold, 2);
  assert.equal(thresholds.get(12).travelTimeHours, 2);
  assert.equal(thresholds.get(12).usesUnknownCountryCells, true);
  assert.equal(thresholds.get(23).travelTimeHours, null);
  const dominant = solveOwnership(graph, cities, 16, workspace);
  assert.deepEqual([...dominant.owners], [2, 2, 2]);
  assert.deepEqual([...dominant.unknownPaths], [1, 1, 0]);
});
