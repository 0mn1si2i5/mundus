import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { auditFineWaterways, verifyWaterwayReview } from './fine-waterways.mjs';
import { sha256 } from './friction.mjs';
import { makeGridGraph } from './grid.mjs';

async function fixture(grid, tiles, route = null) {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-fine-waterways-'));
  await mkdir(join(directory, 'map-aggregated'));
  const land = new Uint8Array(grid.width * grid.height);
  const records = [];
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index];
    const bits = Buffer.alloc(Math.ceil((tile.width * tile.height) / 8));
    for (const [row, column] of tile.cells) {
      const cell = row * tile.width + column;
      bits[cell >>> 3] |= 1 << (cell & 7);
      land[
        Math.floor((tile.row + row) / 4) * grid.width +
          Math.floor((tile.column + column) / 4)
      ] = 1;
    }
    const path = `${index}.fine-land.bin`;
    await writeFile(join(directory, 'map-aggregated', path), bits);
    records.push({
      id: String(index),
      width: tile.width,
      height: tile.height,
      bounds: {
        west: grid.west + tile.column / 120,
        east: grid.west + (tile.column + tile.width) / 120,
        north: grid.north - tile.row / 120,
        south: grid.north - (tile.row + tile.height) / 120,
      },
      sha256: sha256(bits),
      fineLand: {
        path,
        sha256: sha256(bits),
        rawBytes: bits.length,
        encoding: 'row-major packed bits, bit 0 first, 1=valid nonwater pixel',
      },
    });
  }
  const graph = makeGridGraph({
    grid,
    land,
    friction: new Float32Array(land.length).fill(0.001),
    route: route ?? Uint16Array.from(land),
    countryCodes: ['', 'GBR', 'FRA'],
  });
  return { directory, graph, capture: { complete: true, tiles: records } };
}

async function run(grid, tiles, route) {
  const data = await fixture(grid, tiles, route);
  try {
    return await auditFineWaterways({
      grid,
      graph: data.graph,
      capture: data.capture,
      cacheDirectory: data.directory,
    });
  } finally {
    await rm(data.directory, { recursive: true, force: true });
  }
}

const base = {
  width: 2,
  height: 1,
  west: 0,
  north: 1,
  step: 1 / 30,
  wrapLongitude: false,
};

test('finds disconnected fine land merged inside one coarse cell', async () => {
  const report = await run({ ...base, width: 1 }, [
    {
      row: 0,
      column: 0,
      width: 4,
      height: 4,
      cells: [
        [0, 0],
        [3, 3],
      ],
    },
  ]);
  assert.equal(report.fineComponentCount, 2);
  assert.equal(report.mixedCoarseCells, 1);
  assert.equal(report.connections.length, 1);
  assert.equal(report.connections[0].coarseCellCount, 1);
  assert.equal(report.connections[0].edgeCount, 0);
  assert.equal(report.reviewed, false);
});

test('finds false coarse land edges across a water gap, with country closures respected', async () => {
  const tiles = [
    {
      row: 0,
      column: 0,
      width: 8,
      height: 4,
      cells: [
        [1, 1],
        [1, 6],
      ],
    },
  ];
  const open = await run(base, tiles);
  assert.equal(open.connections.length, 1);
  assert.equal(open.connections[0].edgeCount, 1);
  const closed = await run(base, tiles, new Uint16Array([1, 2]));
  assert.equal(closed.fineComponentCount, 2);
  assert.deepEqual(closed.connections, []);
});

test('unions a genuine fine diagonal connection across an east/west tile seam', async () => {
  const report = await run(base, [
    { row: 0, column: 0, width: 4, height: 4, cells: [[1, 3]] },
    { row: 0, column: 4, width: 4, height: 4, cells: [[2, 0]] },
  ]);
  assert.equal(report.fineComponentCount, 1);
  assert.deepEqual(report.connections, []);
});

test('unions a north/south seam and four-tile diagonal corners in both directions', async () => {
  for (const diagonal of ['southeast', 'southwest']) {
    const southeast = diagonal === 'southeast';
    const report = await run({ ...base, height: 2 }, [
      {
        row: 0,
        column: 0,
        width: 4,
        height: 4,
        cells: southeast ? [[3, 3]] : [],
      },
      {
        row: 0,
        column: 4,
        width: 4,
        height: 4,
        cells: southeast ? [] : [[3, 0]],
      },
      {
        row: 4,
        column: 0,
        width: 4,
        height: 4,
        cells: southeast ? [] : [[0, 3]],
      },
      {
        row: 4,
        column: 4,
        width: 4,
        height: 4,
        cells: southeast ? [[0, 0]] : [],
      },
    ]);
    assert.equal(report.fineComponentCount, 1, diagonal);
    assert.deepEqual(report.connections, [], diagonal);
  }
  const northSouth = await run({ ...base, width: 1, height: 2 }, [
    { row: 0, column: 0, width: 4, height: 4, cells: [[3, 1]] },
    { row: 4, column: 0, width: 4, height: 4, cells: [[0, 2]] },
  ]);
  assert.equal(northSouth.fineComponentCount, 1);
});

test('wraps fine land at the dateline without treating it as a false water crossing', async () => {
  const grid = { ...base, width: 10800, west: -180, wrapLongitude: true };
  const data = await fixture(grid, [
    { row: 0, column: 0, width: 21600, height: 4, cells: [[1, 0]] },
    { row: 0, column: 21600, width: 21600, height: 4, cells: [[2, 21599]] },
  ]);
  try {
    const report = await auditFineWaterways({
      grid,
      graph: data.graph,
      capture: data.capture,
      cacheDirectory: data.directory,
    });
    assert.equal(report.fineComponentCount, 1);
    assert.deepEqual(report.connections, []);
  } finally {
    await rm(data.directory, { recursive: true, force: true });
  }
});

test('rejects changed fine captures and incomplete source coverage', async () => {
  const data = await fixture(base, [
    { row: 0, column: 0, width: 8, height: 4, cells: [[1, 1]] },
  ]);
  try {
    const args = {
      grid: base,
      graph: data.graph,
      capture: data.capture,
      cacheDirectory: data.directory,
    };
    await assert.rejects(
      auditFineWaterways({
        ...args,
        capture: { complete: false, tiles: data.capture.tiles },
      }),
      /complete/,
    );
    await writeFile(
      join(data.directory, 'map-aggregated', '0.fine-land.bin'),
      Buffer.alloc(4),
    );
    await assert.rejects(auditFineWaterways(args), /SHA-256 mismatch/);
  } finally {
    await rm(data.directory, { recursive: true, force: true });
  }
});

test('owner approval must retain the exact generated connections and source identity', async () => {
  const report = await run(base, [
    {
      row: 0,
      column: 0,
      width: 8,
      height: 4,
      cells: [
        [1, 1],
        [1, 6],
      ],
    },
  ]);
  assert.doesNotThrow(() =>
    verifyWaterwayReview(report, { ...report, reviewed: true }),
  );
  assert.throws(
    () =>
      verifyWaterwayReview(report, {
        ...report,
        reviewed: true,
        connections: [],
      }),
    /exact generated/,
  );
  assert.throws(
    () =>
      verifyWaterwayReview(report, {
        ...report,
        reviewed: true,
        sourceDigest: 'changed',
      }),
    /exact generated/,
  );
  assert.throws(() => verifyWaterwayReview(report, report), /exact generated/);
});
