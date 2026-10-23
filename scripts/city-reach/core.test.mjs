import { deflateSync, gzipSync, inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWorkspace,
  solveOwnership,
  centreThresholds,
  territoryConnectivity,
  monotonicityViolations,
} from './solver.mjs';
import {
  aggregateFriction,
  packFineLand,
  pixelSha256,
  sha256,
  verifyMapIdentity,
} from './friction.mjs';
import {
  fillUnknownCountries,
  normalizeRouting,
  borderAllowed,
  openCountryPairs,
} from './policy.mjs';
import { makeGridGraph, pointCell, cellPoint } from './grid.mjs';
import {
  encodeOwnerPng,
  decodeOwnerPng,
  encodeDensityPng,
  decodeDensityPng,
  densityTexture,
  ownershipTiles,
} from './png.mjs';
import {
  geoPackageGeometry,
  mollweideGeometry,
  rasterizeGeometry,
} from './geometry.mjs';
import { requireReviewedNames } from './names.mjs';
import { validateCityAsset, validateCityReachManifest } from './schema.mjs';
import { verifyCityReach } from './verify.mjs';
import { regionGrid } from '../build-city-reach.mjs';
import { publishCityReach } from './publication.mjs';
import { waterwaySourceDigest } from './fine-waterways.mjs';
import { MAP_COVERAGE, tileRequests } from './config.mjs';

function adjacencyGraph(matrix) {
  return {
    size: matrix.length,
    land: new Uint8Array(matrix.length).fill(1),
    neighbours(cell, visit) {
      matrix[cell].forEach((cost, next) => {
        if (cell !== next && Number.isFinite(cost)) visit(next, cost);
      });
    },
  };
}
function floyd(matrix) {
  const result = matrix.map((row) => [...row]);
  for (let k = 0; k < result.length; k += 1)
    for (let i = 0; i < result.length; i += 1)
      for (let j = 0; j < result.length; j += 1)
        result[i][j] = Math.min(result[i][j], result[i][k] + result[k][j]);
  return result;
}
function city(
  id,
  ownerIndex,
  population,
  sourceCells,
  centreCell = sourceCells[0],
) {
  return {
    id,
    ownerIndex,
    population,
    sourceCells,
    centreCell,
    mergedIntoId: null,
  };
}

test('exact multi-source solver and bounded thresholds match independent Floyd-Warshall enumeration on 150 graphs', () => {
  let seed = 991;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let experiment = 0; experiment < 150; experiment += 1) {
    const size = 5 + Math.floor(random() * 11);
    const matrix = Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, column) =>
        row === column ? 0 : Infinity,
      ),
    );
    for (let left = 0; left < size; left += 1)
      for (let right = left + 1; right < size; right += 1)
        if (random() < 0.22)
          matrix[left][right] = matrix[right][left] =
            1 + Math.floor(random() * 8);
    const graph = adjacencyGraph(matrix);
    const distances = floyd(matrix);
    const cities = [
      city(12, 1, 100_000, [0]),
      city(23, 2, 1_000_000, [1]),
      city(44, 3, 1_000_000, [2, 3]),
    ];
    const workspace = createWorkspace(size);
    let previous;
    for (const level of [0, 0.25, 1, 4, 16]) {
      const result = solveOwnership(graph, cities, level, workspace).owners;
      for (let point = 0; point < size; point += 1) {
        const expected =
          cities
            .map((candidate) => ({
              candidate,
              score:
                Math.min(
                  ...candidate.sourceCells.map(
                    (source) => distances[point][source],
                  ),
                ) -
                level * Math.log10(candidate.population),
            }))
            .filter((value) => Number.isFinite(value.score))
            .sort(
              (left, right) =>
                left.score - right.score ||
                right.candidate.population - left.candidate.population ||
                left.candidate.id - right.candidate.id,
            )[0]?.candidate.ownerIndex ?? 0;
        assert.equal(
          result[point],
          expected,
          `graph ${experiment}, k ${level}, cell ${point}`,
        );
      }
      if (previous)
        assert.equal(
          monotonicityViolations(previous, result, cities, graph.land),
          0,
        );
      assert.deepEqual(territoryConnectivity(graph, result, cities), []);
      previous = result;
    }
    const thresholds = centreThresholds(graph, cities, workspace);
    for (const focal of cities) {
      const expected = cities
        .filter((candidate) => candidate.population > focal.population)
        .map((candidate) => ({
          candidate,
          threshold:
            Math.min(
              ...candidate.sourceCells.map(
                (source) => distances[focal.centreCell][source],
              ),
            ) / Math.log10(candidate.population / focal.population),
        }))
        .filter((value) => Number.isFinite(value.threshold))
        .sort(
          (left, right) =>
            left.threshold - right.threshold ||
            right.candidate.population - left.candidate.population ||
            left.candidate.id - right.candidate.id,
        )[0];
      assert.equal(
        thresholds.get(focal.id).threshold,
        expected?.threshold ?? null,
      );
      assert.equal(
        thresholds.get(focal.id).parentId,
        expected?.candidate.id ?? null,
      );
    }
  }
});

test('centre-switch threshold agrees with the solver immediately before, at, and after the critical value', () => {
  const graph = adjacencyGraph([
    [0, 2, 4],
    [2, 0, 2],
    [4, 2, 0],
  ]);
  const cities = [city(1, 1, 100_000, [0]), city(2, 2, 1_000_000, [2])];
  const threshold = centreThresholds(graph, cities).get(1);
  assert.equal(threshold.threshold, 4);
  assert.equal(solveOwnership(graph, cities, 3.99).owners[0], 1);
  assert.equal(solveOwnership(graph, cities, 4).owners[0], 2);
  assert.equal(solveOwnership(graph, cities, 4.01).owners[0], 2);
});

test('threshold states distinguish a global root, a blocked larger city, transport missing, and a resolution merge', () => {
  const graph = adjacencyGraph([
    [0, Infinity],
    [Infinity, 0],
  ]);
  const cities = [
    city(1, 1, 100_000, [0]),
    city(2, 2, 1_000_000, [1]),
    { ...city(3, 3, 100_000, []), centreCell: -1 },
    { ...city(4, 4, 100_000, []), centreCell: -1, mergedIntoId: 2 },
  ];
  const values = centreThresholds(graph, cities);
  assert.equal(values.get(1).status, 'no_larger_reachable');
  assert.equal(values.get(2).status, 'root');
  assert.equal(values.get(3).status, 'transport_missing');
  assert.equal(values.get(4).status, 'merged_at_resolution');
});

test('friction uses minimum positive nonwater pixel, with any-land classification and canonical pixel hashes', () => {
  const values = new Float32Array(32).fill(0.00316);
  values[0] = NaN;
  values[1] = 0;
  values[2] = -1;
  values[3] = Infinity;
  values[8] = 0.1;
  values[9] = 0.01;
  const output = aggregateFriction(values, 8, 4);
  assert.equal(output.width, 2);
  assert.equal(output.friction[0], values[9]);
  assert.deepEqual([...output.land], [1, 0]);
  assert.equal(output.landFraction[0], 2 / 16);
  assert.equal(packFineLand(values)[1] & 3, 3);
  const bytes = Buffer.alloc(128);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  assert.equal(pixelSha256(values), sha256(bytes));
  assert.throws(() => aggregateFriction(values, 7, 4), /dimensions/);
});

test('MAP identities fail closed on missing captures and changed source pixels', () => {
  const identity = {
    id: 'x',
    url: 'https://example.com/map',
    hashKind: 'decoded-float32-le',
    sha256: 'a'.repeat(64),
    width: 120,
    height: 120,
  };
  assert.doesNotThrow(() => verifyMapIdentity(identity, { ...identity }));
  assert.throws(() => verifyMapIdentity(identity, null), /no pinned identity/);
  assert.throws(
    () => verifyMapIdentity(identity, { ...identity, sha256: 'b'.repeat(64) }),
    /mismatch/,
  );
});

test('nearest-country transform matches a brute-force squared-Euclidean result and does not wrap longitude', () => {
  const width = 7;
  const height = 5;
  const route = new Uint16Array(width * height);
  route[0] = 1;
  route[20] = 2;
  route[31] = 3;
  const land = new Uint8Array(route.length).fill(1);
  const result = fillUnknownCountries(route, land, width, height);
  for (let cell = 0; cell < route.length; cell += 1) {
    const minimum = Math.min(
      ...[0, 20, 31].map(
        (source) =>
          (Math.floor(cell / width) - Math.floor(source / width)) ** 2 +
          ((cell % width) - (source % width)) ** 2,
      ),
    );
    const eligible = [0, 20, 31]
      .filter(
        (source) =>
          (Math.floor(cell / width) - Math.floor(source / width)) ** 2 +
            ((cell % width) - (source % width)) ** 2 ===
          minimum,
      )
      .map((source) => route[source]);
    assert.ok(eligible.includes(result.route[cell]));
  }
  assert.equal(result.route[6], 2);
  assert.equal(result.filled, route.length - 3);
});

test('routing merges and open-country exceptions retain closed unlisted borders', () => {
  const codes = [
    '',
    'IND',
    'KAS',
    'KAZ',
    'KAB',
    'MAR',
    'SAH',
    'BRT',
    'CHN',
    'HKG',
    'MAC',
    'GIB',
    'ESP',
  ];
  assert.deepEqual(
    [...normalizeRouting(new Uint16Array([2, 4, 6, 7]), codes)],
    [1, 3, 5, 0],
  );
  const pairs = openCountryPairs(codes);
  assert.equal(borderAllowed(8, 9, codes.length, pairs), true);
  assert.equal(borderAllowed(9, 10, codes.length, pairs), true);
  assert.equal(borderAllowed(11, 12, codes.length, pairs), false);
});

test('implicit graph wraps dateline only on a full grid and enforces closed borders', () => {
  const grid = {
    width: 360,
    height: 1,
    west: -180,
    north: 1,
    step: 1,
    wrapLongitude: true,
  };
  const land = new Uint8Array(360);
  land[0] = land[359] = 1;
  const friction = new Float32Array(360).fill(0.01);
  const route = new Uint16Array(360).fill(1);
  let graph = makeGridGraph({
    grid,
    land,
    friction,
    route,
    countryCodes: ['', 'CHN', 'IND'],
  });
  const neighbours = [];
  graph.neighbours(0, (next) => neighbours.push(next));
  assert.deepEqual(neighbours, [359]);
  route[359] = 2;
  graph = makeGridGraph({
    grid,
    land,
    friction,
    route,
    countryCodes: ['', 'CHN', 'IND'],
  });
  const closed = [];
  graph.neighbours(0, (next) => closed.push(next));
  assert.deepEqual(closed, []);
  assert.equal(pointCell({ latitude: 0.5, longitude: 180 }, grid), 0);
  assert.deepEqual(cellPoint(0, grid), { latitude: 0.5, longitude: -179.5 });
});

test('RGB8 PNG preserves every owner byte and reserved value without alpha', () => {
  const owners = new Uint16Array([0, 1, 255, 256, 5944, 65534, 65535]);
  const density = new Uint8Array([0, 20, 50, 80, 100, 160, 255]);
  const bytes = encodeOwnerPng(7, 1, owners);
  const decoded = decodeOwnerPng(bytes);
  assert.deepEqual(decoded.owners, owners);
  assert.equal('density' in decoded, false);
  const densityBytes = encodeDensityPng(7, 1, density);
  assert.deepEqual(decodeDensityPng(densityBytes).density, density);
  assert.equal(densityBytes[25], 2);
  assert.throws(
    () => decodeDensityPng(encodeOwnerPng(1, 1, new Uint16Array([256]))),
    /G = B = 0/,
  );
  // Keep valid RGB8 chunks/CRCs while injecting old combined-format B data.
  const dirty = Buffer.from(bytes);
  const idatLength = dirty.readUInt32BE(33);
  const pixels = inflateSync(dirty.subarray(41, 41 + idatLength));
  pixels[3] = 1;
  const compressed = deflateSync(pixels);
  const idat = Buffer.alloc(compressed.length + 12);
  idat.writeUInt32BE(compressed.length);
  idat.write('IDAT', 4);
  compressed.copy(idat, 8);
  let crc = 0xffffffff;
  for (const byte of idat.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  idat.writeUInt32BE((crc ^ 0xffffffff) >>> 0, idat.length - 4);
  const combinedFormat = Buffer.concat([
    dirty.subarray(0, 33),
    idat,
    dirty.subarray(45 + idatLength),
  ]);
  assert.throws(() => decodeOwnerPng(combinedFormat), /B = 0/);
  assert.throws(() => decodeDensityPng(combinedFormat), /G = B = 0/);

  assert.equal(bytes[25], 2);
  const broken = Buffer.from(bytes);
  broken[50] ^= 1;
  assert.throws(() => decodeOwnerPng(broken), /CRC/);
  assert.throws(
    () => encodeOwnerPng(4097, 1, new Uint16Array(4097)),
    /dimensions/,
  );
});

test('quality textures sample categorical owners by nearest pixel and retain disputed hatch ids', () => {
  const grid = { width: 5, height: 3 };
  const owners = Uint16Array.from({ length: 15 }, (_, index) => index + 1);
  const disputed = new Uint8Array(15);
  disputed[8] = 1;
  const output = ownershipTiles(
    { grid, owners, disputed },
    { stride: 2, tileColumns: 1, tileRows: 1 },
  );
  assert.deepEqual([output.width, output.height], [3, 2]);
  const decoded = decodeOwnerPng(output.tiles[0].bytes);
  assert.deepEqual([...decoded.owners], [7, 65535, 10, 12, 14, 15]);
});

test('low-detail encoding keeps four-row blocks when 4350 rows leave a partial final block', () => {
  const grid = { width: 2, height: 4350 };
  const owners = Uint16Array.from(
    { length: 8700 },
    (_, index) => Math.floor(index / 2) + 1,
  );
  const density = Uint8Array.from(owners, (owner) => owner % 255);
  const output = ownershipTiles(
    { grid, owners, density, disputed: new Uint8Array(8700) },
    { stride: 4, tileColumns: 1, tileRows: 2 },
  );
  assert.deepEqual([output.width, output.height], [1, 1088]);
  const top = decodeOwnerPng(output.tiles[0].bytes);
  const bottom = decodeOwnerPng(output.tiles[1].bytes);
  assert.equal(top.owners[0], 3);
  assert.equal(top.owners[543], 2175);
  assert.equal(bottom.owners[0], 2179);
  assert.deepEqual([...bottom.owners.slice(-2)], [4347, 4350]);
  // Density uses eight-row blocks: 544 rows, the last clipped to row 4,349.
  const shared = densityTexture({ grid, density }, { densityStride: 8 });
  const brightness = decodeDensityPng(shared.bytes);
  assert.deepEqual([brightness.width, brightness.height], [1, 544]);
  assert.equal(brightness.density[0], 5);
  assert.equal(brightness.density[543], 4349 % 255);
});

test('rasterizer respects polygon holes and all_touched urban footprints', () => {
  const grid = { width: 4, height: 4, west: 0, north: 4, step: 1 };
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
        [1, 1],
      ],
    ],
  };
  const target = new Uint16Array(16);
  rasterizeGeometry(polygon, grid, target, 1);
  assert.deepEqual(
    [...target],
    [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1],
  );
  const tiny = {
    type: 'Polygon',
    coordinates: [
      [
        [0.7, 3.3],
        [1.3, 3.3],
        [1.3, 3.7],
        [0.7, 3.7],
        [0.7, 3.3],
      ],
    ],
  };
  const centre = new Uint16Array(16);
  rasterizeGeometry(tiny, grid, centre, 2);
  assert.equal(
    centre.reduce((sum, value) => sum + value, 0),
    0,
  );
  rasterizeGeometry(tiny, grid, centre, 2, { allTouched: true });
  assert.deepEqual([...centre.subarray(0, 4)], [2, 2, 0, 0]);
});

test('GeoPackage WKB decoding handles points, Mollweide origin and corrupt counts', () => {
  const point = Buffer.alloc(29);
  point.write('GP');
  point[3] = 1;
  point[8] = 1;
  point.writeUInt32LE(1, 9);
  assert.deepEqual(mollweideGeometry(geoPackageGeometry(point)), {
    type: 'Point',
    coordinates: [0, 0],
  });
  const polygon = Buffer.alloc(17);
  polygon.write('GP');
  polygon[3] = 1;
  polygon[8] = 1;
  polygon.writeUInt32LE(3, 9);
  polygon.writeUInt32LE(0xffffffff, 13);
  assert.throws(
    () => geoPackageGeometry(polygon),
    /Truncated WKB polygon rings/,
  );
});

test('review records missing Chinese without adopting proximity candidates and keeps fatal name gates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-reach-names-'));
  try {
    const rows = [
      {
        id: 1,
        name: { en: 'A', zh: null },
        country: { en: 'Country', zh: '国家' },
        matchType: 'none',
        proximityCandidate: '候选',
        hasOverride: false,
      },
    ];
    const path = join(directory, 'audit.json');
    await assert.doesNotReject(requireReviewedNames(rows, [1], path));
    const audit = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(audit.missingCount, 0);
    assert.equal(audit.missingChineseCities[0].name.zh, null);
    assert.equal(audit.cities[0].name.zh, null);
    assert.equal(audit.cities[0].proximityCandidate, '候选');
    assert.deepEqual(audit.nameReview, {
      requiredCityCount: 1,
      missingChineseCityCount: 1,
      requiredMissingChineseCityCount: 1,
      matchCounts: { override: 0, exact: 0, none: 1 },
    });
    rows[0].name.en = ' ';
    await assert.rejects(
      requireReviewedNames(rows, [1], path),
      /1 required cities lack English display names/,
    );
    assert.equal(
      JSON.parse(await readFile(path, 'utf8')).missingRequiredEnglishNames[0]
        .id,
      1,
    );
    rows[0].name.en = 'A';
    rows.push({ ...structuredClone(rows[0]), id: 2 });
    rows[1].country.zh = null;
    await assert.rejects(
      requireReviewedNames(rows, [1], path),
      /1 asset cities lack reviewed country names/,
    );
    assert.equal(
      JSON.parse(await readFile(path, 'utf8')).missingCountryNames[0].id,
      2,
    );
    rows[1].country.zh = '国家';
    const fallbackAudit = await requireReviewedNames(rows, [1], path);
    assert.equal(fallbackAudit.nameReview.missingChineseCityCount, 2);
    assert.equal(fallbackAudit.nameReview.requiredMissingChineseCityCount, 1);
    rows[0].name.zh = '重复';
    rows[1].name.zh = '重复';
    rows.forEach((row) => {
      row.matchType = 'exact';
    });
    await assert.rejects(
      requireReviewedNames(rows, [1], path),
      /1 conflicting/,
    );
    rows[0].hasOverride = true;
    rows[0].matchType = 'override';
    await assert.rejects(
      requireReviewedNames(rows, [1], path),
      /1 conflicting/,
    );
    rows.forEach((row) => {
      row.hasOverride = true;
      row.matchType = 'override';
    });
    await assert.doesNotReject(requireReviewedNames(rows, [1], path));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('regional benchmark grids align to source pixels and cannot wrap partial longitude', () => {
  assert.deepEqual(regionGrid('-1,50,1,52'), {
    width: 60,
    height: 60,
    west: -1,
    north: 52,
    step: 1 / 30,
    wrapLongitude: false,
  });
  assert.throws(() => regionGrid('-1,50,1.01,52'), /align/);
});

test('city table rejects an ascending-size cycle and verification fails closed on orphan assets', async () => {
  const row = {
    id: 1,
    ownerIndex: 1,
    name: { en: 'A', zh: '甲' },
    nameMatchType: 'exact',
    country: { en: 'Country', zh: '国家' },
    population: 100_000,
    point: { latitude: 0, longitude: 0 },
    threshold: 1,
    parentId: 1,
    status: 'ok',
    mergedIntoId: null,
  };
  assert.throws(
    () =>
      validateCityAsset({
        formatVersion: 2,
        referenceYear: 2025,
        universeMinPopulation: 100_000,
        cities: [row],
      }),
    /parent/,
  );
  assert.throws(
    () => validateCityReachManifest({ id: 'city-reach' }),
    /manifest/,
  );
  const missingCountryAsset = {
    formatVersion: 2,
    referenceYear: 2025,
    universeMinPopulation: 100_000,
    cities: [
      {
        ...row,
        threshold: null,
        parentId: null,
        status: 'transport_missing',
        country: { en: 'Country', zh: null },
      },
    ],
  };
  assert.throws(() => validateCityAsset(missingCountryAsset), /city 1/);
  const directory = await mkdtemp(join(tmpdir(), 'mundus-reach-orphan-'));
  try {
    await mkdir(join(directory, 'src/data/generated'), { recursive: true });
    await writeFile(
      join(directory, 'src/data/generated/city-reach.json'),
      '{}',
    );
    await assert.rejects(verifyCityReach(directory), /without its manifest/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('atomic publication preserves a required city without Chinese and rejects byte/count alteration', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mundus-reach-publish-'));
  try {
    const grid = {
      width: 1,
      height: 1,
      west: 0,
      north: 1 / 30,
      step: 1 / 30,
      wrapLongitude: false,
    };
    const cities = [
      {
        ...city(1, 1, 100_000, [0]),
        sourceName: 'A',
        countryName: 'Guinea',
        point: { latitude: 1 / 60, longitude: 1 / 60 },
        centrePoint: { latitude: 1 / 60, longitude: 1 / 60 },
      },
    ];
    const names = [
      {
        id: 1,
        name: { en: 'A', zh: null },
        country: { en: 'Guinea', zh: '几内亚' },
      },
    ];
    const capture = {
      schemaVersion: 1,
      map: {
        schemaVersion: 1,
        complete: true,
        coverageId: MAP_COVERAGE,
        grid,
        tiles: [
          {
            id: '0_0',
            url: 'https://data.malariaatlas.org/geoserver/Accessibility/wcs?service=WCS&version=2.0.1&request=GetCoverage&coverageId=Accessibility__202001_Global_Motorized_Friction_Surface&format=image%2Ftiff&subset=Long%280%2C0.03333333333333333%29&subset=Lat%280%2C0.03333333333333333%29',
            hashKind: 'decoded-float32-le',
            sha256: 'a'.repeat(64),
            responseSha256: 'b'.repeat(64),
            bounds: tileRequests(grid)[0].bounds,
            width: 4,
            height: 4,
            fineLand: {
              sha256: 'c'.repeat(64),
              rawBytes: 2,
              encoding:
                'row-major packed bits, bit 0 first, 1=valid nonwater pixel',
            },
          },
        ],
      },
    };
    capture.narrowWaterwaysAudit = {
      schemaVersion: 1,
      reviewed: true,
      sourceDigest: waterwaySourceDigest(grid, capture.map),
      connections: [],
    };
    await assert.doesNotReject(
      requireReviewedNames(names, [1], join(root, 'name-review.json')),
    );
    const published = await publishCityReach({
      root,
      grid,
      cities,
      names,
      thresholds: new Map([
        [1, { threshold: null, parentId: null, status: 'root' }],
      ]),
      levelOwners: new Map(
        [0.25, 0.5, 1, 2, 4, 8, 16].map((level) => [
          level,
          new Uint16Array([1]),
        ]),
      ),
      disputed: new Uint8Array(1),
      density: new Uint8Array([100]),
      sourceCapture: capture,
      captureArchiveDirectory: join(root, 'source-records'),
      retrievedAt: '2026-10-11',
    });
    assert.equal(published.cityAsset.cities[0].ownerIndex, 1);
    assert.deepEqual(published.cityAsset.cities[0].name, {
      en: 'A',
      zh: null,
    });
    assert.equal(published.cityAsset.cities[0].nameMatchType, 'none');
    assert.deepEqual(published.manifest.nameReview, {
      requiredCityCount: 1,
      missingChineseCityCount: 1,
      requiredMissingChineseCityCount: 1,
      matchCounts: { override: 0, exact: 0, none: 1 },
    });
    const obsoletePath = join(
      root,
      'public/data/city-reach/population-4-high-0-0.png',
    );
    await writeFile(obsoletePath, encodeOwnerPng(1, 1, new Uint16Array([1])));
    await assert.rejects(verifyCityReach(root), /Unlisted city-reach PNG/);
    await rm(obsoletePath);
    const bloated = structuredClone(published.manifest);
    bloated.densityAsset.rawBytes = 3_000_000;
    assert.throws(
      () => validateCityReachManifest(bloated),
      /3 MB texture budget/,
    );
    const unapprovedDetail = structuredClone(published.manifest);
    unapprovedDetail.qualityTiers.high = {
      ...unapprovedDetail.qualityTiers.low,
      stride: 1,
    };
    assert.throws(
      () => validateCityReachManifest(unapprovedDetail),
      /only the approved low/,
    );
    const summary = JSON.parse(
      await readFile(join(root, published.manifest.sourceCapture.path), 'utf8'),
    );
    assert.equal(summary.schemaVersion, 2);
    assert.equal(summary.narrowWaterwaysAudit.reviewed, true);
    assert.equal(summary.narrowWaterwaysAudit.connectionCount, 0);
    assert.deepEqual(summary.requiredCityIds, [1]);
    const archivedCapture = await readFile(published.sourceCaptureArchivePath);
    assert.equal(sha256(archivedCapture), summary.fullCapture.sha256);
    assert.equal(archivedCapture.length, summary.fullCapture.rawBytes);
    assert.equal('tiles' in summary.map, false);
    assert.equal('connections' in summary.narrowWaterwaysAudit, false);
    const wrongCounts = structuredClone(published.manifest);
    wrongCounts.nameReview.missingChineseCityCount = 0;
    assert.throws(
      () => validateCityReachManifest(wrongCounts),
      /name review counts/,
    );
    assert.deepEqual(await verifyCityReach(root), {
      present: true,
      assets: 10,
    });
    await t.test(
      'full-grid name obligations survive subsampling of a small territory',
      async () => {
        const fullRoot = join(root, 'full-grid');
        const fullGrid = { ...grid, width: 5 };
        const request = tileRequests(fullGrid)[0];
        const fullCapture = structuredClone(capture);
        fullCapture.map.grid = fullGrid;
        Object.assign(fullCapture.map.tiles[0], request, {
          width: 20,
          height: 4,
        });
        fullCapture.map.tiles[0].fineLand.rawBytes = 10;
        fullCapture.narrowWaterwaysAudit.sourceDigest = waterwaySourceDigest(
          fullGrid,
          fullCapture.map,
        );
        const smaller = {
          ...cities[0],
          id: 2,
          ownerIndex: 2,
          population: 100_000,
        };
        const result = await publishCityReach({
          root: fullRoot,
          grid: fullGrid,
          cities: [{ ...cities[0], population: 200_000 }, smaller],
          names: [
            ...names,
            { ...names[0], id: 2, name: { en: 'B', zh: null } },
          ],
          thresholds: new Map([
            [1, { threshold: null, parentId: null, status: 'root' }],
            [2, { threshold: 1, parentId: 1, status: 'ok' }],
          ]),
          levelOwners: new Map(
            [0.25, 0.5, 1, 2, 4, 8, 16].map((level) => [
              level,
              new Uint16Array([2, 1, 1, 1, 1]),
            ]),
          ),
          disputed: new Uint8Array(5),
          density: new Uint8Array(5),
          sourceCapture: fullCapture,
          captureArchiveDirectory: join(root, 'source-records'),
          retrievedAt: '2026-10-12',
        });
        assert.equal(result.manifest.nameReview.requiredCityCount, 2);
        assert.deepEqual(
          [
            ...decodeOwnerPng(
              await readFile(
                join(
                  fullRoot,
                  result.manifest.ownershipAssets['4'].low[0].path,
                ),
              ),
            ).owners,
          ],
          [1, 1],
        );
        assert.deepEqual(await verifyCityReach(fullRoot), {
          present: true,
          assets: 10,
        });
        const summaryPath = join(fullRoot, result.manifest.sourceCapture.path);
        const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
        assert.deepEqual(summary.requiredCityIds, [1, 2]);
        summary.requiredCityIds = [2];
        const changedBytes = Buffer.from(`${JSON.stringify(summary)}\n`);
        await writeFile(summaryPath, changedBytes);
        result.manifest.sourceCapture = {
          ...result.manifest.sourceCapture,
          sha256: sha256(changedBytes),
          rawBytes: changedBytes.length,
          gzipBytes: gzipSync(changedBytes, { level: 9, mtime: 0 }).length,
        };
        await writeFile(
          join(fullRoot, 'src/data/manifests/city-reach.json'),
          JSON.stringify(result.manifest),
        );
        await assert.rejects(
          verifyCityReach(fullRoot),
          /omit a displayed owner, parent or root/,
        );
      },
    );
    await t.test(
      'disputed raw roots and parents do not inflate final manifest/report required counts',
      async () => {
        const disputedRoot = join(root, 'disputed');
        const disputedCities = [
          { ...cities[0], population: 400_000 },
          {
            ...cities[0],
            id: 2,
            ownerIndex: 2,
            population: 100_000,
          },
          {
            ...cities[0],
            id: 3,
            ownerIndex: 3,
            population: 200_000,
          },
        ];
        const disputedNames = disputedCities.map(({ id }) => ({
          ...names[0],
          id,
          name: { en: `City ${id}`, zh: null },
        }));
        const result = await publishCityReach({
          root: disputedRoot,
          grid,
          cities: disputedCities,
          names: disputedNames,
          thresholds: new Map([
            [1, { threshold: null, parentId: null, status: 'root' }],
            [2, { threshold: 1, parentId: 3, status: 'ok' }],
            [
              3,
              {
                threshold: null,
                parentId: null,
                status: 'transport_missing',
              },
            ],
          ]),
          levelOwners: new Map(
            [0.25, 0.5, 1, 2, 4, 8, 16].map((level) => [
              level,
              new Uint16Array([1]),
            ]),
          ),
          disputed: new Uint8Array([1]),
          density: new Uint8Array([100]),
          sourceCapture: capture,
          captureArchiveDirectory: join(root, 'source-records'),
          retrievedAt: '2026-10-11',
        });
        assert.ok(
          result.cityAsset.cities.every(
            (row) => row.status === 'disputed' && row.parentId === null,
          ),
        );
        assert.deepEqual(result.manifest.nameReview, {
          requiredCityCount: 0,
          missingChineseCityCount: 3,
          requiredMissingChineseCityCount: 0,
          matchCounts: { override: 0, exact: 0, none: 3 },
        });
        const finalReport = JSON.parse(
          await readFile(
            join(disputedRoot, 'tmp/city-reach/name-review.json'),
            'utf8',
          ),
        );
        assert.deepEqual(finalReport.nameReview, result.manifest.nameReview);
        assert.ok(finalReport.cities.every((row) => !row.required));
        assert.deepEqual(await verifyCityReach(disputedRoot), {
          present: true,
          assets: 10,
        });
      },
    );
    const path = join(
      root,
      published.manifest.ownershipAssets['4'].low[0].path,
    );
    await writeFile(path, 'corrupt');
    await assert.rejects(verifyCityReach(root), /identity\/budget/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
