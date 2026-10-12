import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { writeArrayBuffer } from 'geotiff';
import { decodeMapTiff, sha256 } from './friction.mjs';
import {
  pinnedFile,
  extractZipMember,
  loadMapGrid,
  readGhslCities,
} from './sources.mjs';
import { tileRequests } from './config.mjs';
import { readPopulationGrid, densityBytes } from './prepare.mjs';

function tiff(width, height, west, north, value = 0.01) {
  return Buffer.from(
    writeArrayBuffer(new Float32Array(width * height).fill(value), {
      width,
      height,
      ModelPixelScale: [1 / 120, 1 / 120, 0],
      ModelTiepoint: [0, 0, 0, west, north, 0],
      GeographicTypeGeoKey: 4326,
    }),
  );
}

test('GeoTIFF decoding verifies official WCS pixel resolution and bounds', async () => {
  const request = {
    id: 'test',
    bounds: { west: 0, east: 1 / 30, south: 0, north: 1 / 30 },
  };
  const result = await decodeMapTiff(tiff(4, 4, 0, 1 / 30), request);
  assert.deepEqual([result.width, result.height], [4, 4]);
  assert.equal(result.values[0], Math.fround(0.01));
  await assert.rejects(decodeMapTiff(tiff(4, 4, 1, 1 / 30), request), /bounds/);
});

test('MAP capture checkpoints every tile, resumes validated caches, and rejects corruption', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-reach-map-'));
  const grid = {
    width: 600,
    height: 1,
    west: 0,
    north: 1 / 30,
    step: 1 / 30,
    wrapLongitude: false,
  };
  const requests = tileRequests(grid);
  const capturePath = join(directory, 'capture.json');
  let requestsMade = 0;
  const fetchImplementation = async (url) => {
    requestsMade += 1;
    if (url === requests[1].url) throw new Error('Interrupted second tile');
    return new Response(tiff(1200, 4, 0, 1 / 30));
  };
  try {
    await assert.rejects(
      loadMapGrid({
        grid,
        cacheDirectory: directory,
        capturePath,
        capture: true,
        fetchImplementation,
      }),
      /Interrupted/,
    );
    const incomplete = JSON.parse(await readFile(capturePath, 'utf8'));
    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.tiles.length, 1);
    assert.equal(requestsMade, 3);
    await assert.rejects(
      loadMapGrid({
        grid,
        cacheDirectory: directory,
        capturePath,
        capture: false,
        fetchImplementation,
      }),
      /incomplete/,
    );
    requestsMade = 0;
    const resumed = await loadMapGrid({
      grid,
      cacheDirectory: directory,
      capturePath,
      capture: true,
      fetchImplementation: async (url) => {
        requestsMade += 1;
        assert.equal(url, requests[1].url);
        return new Response(tiff(1200, 4, 10, 1 / 30));
      },
    });
    assert.equal(requestsMade, 1);
    assert.equal(resumed.capture.complete, true);
    assert.equal(resumed.capture.tiles.length, 2);
    const rebuilt = await loadMapGrid({
      grid,
      cacheDirectory: directory,
      capturePath,
      capture: false,
      fetchImplementation: () => {
        throw new Error('Valid cache must avoid network');
      },
    });
    assert.deepEqual(rebuilt.friction, resumed.friction);
    const path = join(
      directory,
      'map-aggregated',
      `${requests[0].id}.fine-land.bin`,
    );
    const corrupt = await readFile(path);
    corrupt[0] ^= 1;
    await writeFile(path, corrupt);
    await assert.rejects(
      loadMapGrid({
        grid,
        cacheDirectory: directory,
        capturePath,
        capture: false,
      }),
      /fine-land cache SHA-256 mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pinned downloads and extracted ZIP members fail closed when either cache is altered', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-reach-zip-'));
  try {
    const content = Buffer.from('pinned city data');
    const file = join(directory, 'data.gpkg');
    const archive = join(directory, 'source.zip');
    await writeFile(file, content);
    await promisify(execFile)('zip', ['-j', archive, file]);
    const bytes = await readFile(archive);
    const source = {
      url: 'https://example.com/source.zip',
      sha256: sha256(bytes),
    };
    await pinnedFile(source, archive, () => {
      throw new Error('Existing pinned source must not download');
    });
    const output = join(directory, 'extracted.gpkg');
    await extractZipMember(archive, output, /^data\.gpkg$/);
    assert.deepEqual(await readFile(output), content);
    await writeFile(output, 'corrupt');
    await assert.rejects(
      extractZipMember(archive, output, /^data\.gpkg$/),
      /Extracted source SHA-256 mismatch/,
    );
    await writeFile(archive, 'corrupt');
    await assert.rejects(
      pinnedFile(source, archive),
      /Source SHA-256 mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function gpkgPoint(x, y) {
  const bytes = Buffer.alloc(29);
  bytes.write('GP');
  bytes[3] = 1;
  bytes[8] = 1;
  bytes.writeUInt32LE(1, 9);
  bytes.writeDoubleLE(x, 13);
  bytes.writeDoubleLE(y, 21);
  return bytes;
}
function gpkgPolygon() {
  const points = [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000],
    [0, 0],
  ];
  const bytes = Buffer.alloc(21 + points.length * 16);
  bytes.write('GP');
  bytes[3] = 1;
  bytes[8] = 1;
  bytes.writeUInt32LE(3, 9);
  bytes.writeUInt32LE(1, 13);
  bytes.writeUInt32LE(points.length, 17);
  points.forEach(([x, y], index) => {
    bytes.writeDoubleLE(x, 21 + index * 16);
    bytes.writeDoubleLE(y, 29 + index * 16);
  });
  return bytes;
}

test('GHSL GeoPackage uses UC_centroids rather than representative polygon points and filters at 100,000', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const directory = await mkdtemp(join(tmpdir(), 'mundus-reach-gpkg-'));
  const path = join(directory, 'source.gpkg');
  const database = new DatabaseSync(path);
  try {
    database.exec(
      'CREATE TABLE GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A ("﻿ID_UC_G0" TEXT, "﻿GC_UCN_MAI_2025" TEXT, "﻿GC_CNT_GAD_2025" TEXT, "﻿GC_POP_TOT_2025" TEXT, geom BLOB); CREATE TABLE UC_centroids (ID_UC_G0 TEXT, geom BLOB)',
    );
    const insert = database.prepare(
      'INSERT INTO GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A VALUES (?, ?, ?, ?, ?)',
    );
    const centroid = database.prepare('INSERT INTO UC_centroids VALUES (?, ?)');
    insert.run('673', '﻿Coyah', '﻿Guinea', '100000', gpkgPolygon());
    centroid.run('673', gpkgPoint(0, 0));
    insert.run('12', 'Small', 'Country', '99999', gpkgPolygon());
    centroid.run('12', gpkgPoint(1000, 1000));
    database.close();
    const result = await readGhslCities(path);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 673);
    assert.equal(result[0].sourceName, 'Coyah');
    assert.equal(result[0].population, 100_000);
    assert.deepEqual(result[0].point, { latitude: 0, longitude: 0 });
    const altered = new DatabaseSync(path);
    altered.exec("DELETE FROM UC_centroids WHERE ID_UC_G0 = '673'");
    altered.close();
    await assert.rejects(
      readGhslCities(path),
      /GHSL city 673 has no official UC_centroids record/,
    );
  } finally {
    try {
      database.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test('GHS-POP windows sum actual pixel counts and shared display density stays distinct from city 2025 mass', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-reach-pop-'));
  try {
    const path = join(directory, 'population.tif');
    await writeFile(path, tiff(4, 4, 0, 1 / 30, 10));
    const grid = {
      width: 1,
      height: 1,
      west: 0,
      north: 1 / 30,
      step: 1 / 30,
      wrapLongitude: false,
    };
    const population = await readPopulationGrid(path, grid);
    assert.deepEqual([...population], [160]);
    const brightness = densityBytes(population, grid);
    assert.ok(brightness[0] > 0 && brightness[0] < 255);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('zero population remains zero while an entirely missing coarse cell uses density sentinel 255', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mundus-reach-pop-missing-'));
  try {
    const path = join(directory, 'population.tif');
    const pixels = Float32Array.from({ length: 48 }, (_, index) => {
      const column = index % 12;
      return column < 4 ? 0 : column < 8 ? -9999 : 10;
    });
    await writeFile(
      path,
      Buffer.from(
        writeArrayBuffer(pixels, {
          width: 12,
          height: 4,
          ModelPixelScale: [1 / 120, 1 / 120, 0],
          ModelTiepoint: [0, 0, 0, 0, 1 / 30, 0],
          GeographicTypeGeoKey: 4326,
        }),
      ),
    );
    const grid = {
      width: 3,
      height: 1,
      west: 0,
      north: 1 / 30,
      step: 1 / 30,
      wrapLongitude: false,
    };
    const population = await readPopulationGrid(path, grid);
    assert.equal(population[0], 0);
    assert.ok(Number.isNaN(population[1]));
    assert.equal(population[2], 160);
    const density = densityBytes(population, grid);
    assert.equal(density[0], 0);
    assert.equal(density[1], 255);
    assert.ok(density[2] > 0 && density[2] < 255);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
