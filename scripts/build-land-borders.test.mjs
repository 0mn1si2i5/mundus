import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { topology } from 'topojson-server';
import {
  ASSET_PATH,
  MANIFEST_PATH,
  buildLandBorders,
  readSourceTopology,
  serializeLandBorders,
  sha256,
} from './build-land-borders.mjs';

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

function unit(countryId, polygons) {
  return {
    type: 'Feature',
    properties: { countryId },
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  };
}

const SOURCE = { path: 'fixture.json', sha256: '0'.repeat(64) };

function fixture() {
  return topology({
    countries: {
      type: 'FeatureCollection',
      features: [
        // A's small island sorts after its larger mainland.
        unit('ne-001', [square(5, 5, 0.2), square(0, 0, 1)]),
        unit('ne-002', [square(1, 0, 1)]),
        // Touches ne-002 at one corner only.
        unit('ne-003', [square(2, 1, 1)]),
        unit('ne-004', [square(5.2, 5, 0.2)]),
      ],
    },
  });
}

test('joins land parts that share an arc and ignores a shared point', () => {
  const output = buildLandBorders(fixture(), SOURCE, {
    reviewedBorders: [],
    fixedLinks: [],
  });
  assert.deepEqual(output.parts, {
    'ne-001/0': ['ne-002/0'],
    'ne-001/1': ['ne-004/0'],
    'ne-002/0': ['ne-001/0'],
    'ne-004/0': ['ne-001/1'],
  });
});

test('adds reviewed borders and fixed links by the land part at a point', () => {
  const output = buildLandBorders(fixture(), SOURCE, {
    reviewedBorders: [
      {
        a: { countryId: 'ne-002', point: [1.5, 0.5] },
        b: { countryId: 'ne-003', point: [2.5, 1.5] },
        reason: 'fixture',
      },
    ],
    fixedLinks: [
      {
        id: 'causeway',
        name: { en: 'Causeway', zh: '长堤' },
        opened: 2000,
        a: { countryId: 'ne-001', point: [0.5, 0.5] },
        b: { countryId: 'ne-001', point: [5.1, 5.1] },
      },
    ],
  });
  assert.deepEqual(output.parts['ne-003/0'], ['ne-002/0']);
  assert.deepEqual(output.fixedLinks, [
    {
      id: 'causeway',
      name: { en: 'Causeway', zh: '长堤' },
      opened: 2000,
      a: 'ne-001/0',
      b: 'ne-001/1',
    },
  ]);
});

test('rejects redundant reviews, unresolved points and self links', () => {
  const run = (options) =>
    buildLandBorders(fixture(), SOURCE, {
      reviewedBorders: [],
      fixedLinks: [],
      ...options,
    });
  assert.throws(
    () =>
      run({
        reviewedBorders: [
          {
            a: { countryId: 'ne-001', point: [0.5, 0.5] },
            b: { countryId: 'ne-002', point: [1.5, 0.5] },
            reason: 'fixture',
          },
        ],
      }),
    /already in the source/u,
  );
  assert.throws(
    () =>
      run({
        reviewedBorders: [
          {
            a: { countryId: 'ne-001', point: [3.5, 3.5] },
            b: { countryId: 'ne-002', point: [1.5, 0.5] },
            reason: 'fixture',
          },
        ],
      }),
    /expected one land part, found 0/u,
  );
  assert.throws(
    () =>
      run({
        fixedLinks: [
          {
            id: 'loop',
            name: { en: 'Loop', zh: '环' },
            opened: 2000,
            a: { countryId: 'ne-002', point: [1.2, 0.5] },
            b: { countryId: 'ne-002', point: [1.8, 0.5] },
          },
        ],
      }),
    /joins one land part to itself/u,
  );
});

test('the published asset is the deterministic build of the pinned topology', async () => {
  const { topology: source, source: identity } = await readSourceTopology();
  const expected = serializeLandBorders(buildLandBorders(source, identity));
  const [asset, manifestText] = await Promise.all([
    readFile(ASSET_PATH, 'utf8'),
    readFile(MANIFEST_PATH, 'utf8'),
  ]);
  assert.equal(asset, expected);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.derivedAssetSha256, sha256(Buffer.from(asset)));
  assert.deepEqual(manifest.sourceAssets, { '50m': identity });
});
