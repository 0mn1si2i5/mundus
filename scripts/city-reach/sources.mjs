import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  COUNTRY_SOURCES,
  GHSL_SOURCE,
  MIN_POPULATION,
  tileRequests,
} from './config.mjs';
import {
  decodeMapTiff,
  sha256,
  pixelSha256,
  aggregateFriction,
  verifyMapIdentity,
  packFineLand,
} from './friction.mjs';
import { geoPackageGeometry, mollweideGeometry } from './geometry.mjs';

export const POPULATION_SOURCE = Object.freeze({
  url: 'https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2020_GLOBE_R2023A_4326_30ss/V1-0/GHS_POP_E2020_GLOBE_R2023A_4326_30ss_V1_0.zip',
  sha256: '579fb7477b33d9be61e9562b170ea108a670b85ef6fe23b61a22d17200929636',
  licenseName: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
});

export async function fileSha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function pinnedFile(source, path, fetchImplementation = fetch) {
  try {
    await access(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(dirname(path), { recursive: true });
    const response = await fetchImplementation(source.url);
    if (!response.ok || !response.body)
      throw new Error(
        `Source download failed (${response.status}): ${source.url}`,
      );
    const temporary = `${path}.download-${process.pid}`;
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { flags: 'wx' }),
    );
    const actual = await fileSha256(temporary);
    if (actual !== source.sha256)
      throw new Error(
        `Source SHA-256 mismatch: expected ${source.sha256}, received ${actual}; downloaded bytes remain at ${temporary}`,
      );
    await rename(temporary, path);
  }
  const actual = await fileSha256(path);
  if (actual !== source.sha256)
    throw new Error(
      `Source SHA-256 mismatch: ${path}; expected ${source.sha256}, received ${actual}`,
    );
  return path;
}

export async function extractZipMember(archive, destination, basenamePattern) {
  const { stdout } = await promisify(execFile)('unzip', ['-Z1', archive], {
    maxBuffer: 1024 * 1024,
  });
  const members = stdout
    .split('\n')
    .filter((member) => basenamePattern.test(member.split('/').at(-1)));
  if (members.length !== 1)
    throw new Error(
      `Expected one archive member matching ${basenamePattern}; found ${members.length}`,
    );
  try {
    await access(destination);
    // Compute the expected member hash from the already pinned archive, not mutable cache metadata.
    const child = spawn('unzip', ['-p', archive, members[0]], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const completed = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`unzip failed (${code}): ${stderr}`)),
      );
    });
    const hash = createHash('sha256');
    for await (const chunk of child.stdout) hash.update(chunk);
    await completed;
    const expected = hash.digest('hex');
    const actual = await fileSha256(destination);
    if (actual !== expected)
      throw new Error(
        `Extracted source SHA-256 mismatch: ${destination}; expected ${expected}, received ${actual}`,
      );
    return destination;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.extract-${process.pid}`;
  const child = spawn('unzip', ['-p', archive, members[0]], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`unzip failed (${code}): ${stderr}`)),
    );
  });
  await Promise.all([
    pipeline(child.stdout, createWriteStream(temporary, { flags: 'wx' })),
    completed,
  ]);
  await rename(temporary, destination);
  return destination;
}

export async function readGhslCities(path, minPopulation = MIN_POPULATION) {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(path, { readOnly: true });
  const table = 'GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A';
  const quote = (value) => `"${value.replaceAll('"', '""')}"`;
  const field = (tableName, name) => {
    const found = database
      .prepare(`PRAGMA table_info(${quote(tableName)})`)
      .all()
      .find((column) => column.name.replace(/^\uFEFF/, '') === name);
    if (!found) throw new Error(`GHSL table ${tableName} is missing ${name}`);
    return quote(found.name);
  };
  try {
    const rows = database
      .prepare(
        `SELECT g.${field(table, 'ID_UC_G0')} AS id, g.${field(table, 'GC_UCN_MAI_2025')} AS name, g.${field(table, 'GC_CNT_GAD_2025')} AS country, g.${field(table, 'GC_POP_TOT_2025')} AS population, g.${field(table, 'geom')} AS polygon, c.${field('UC_centroids', 'geom')} AS centroid FROM ${quote(table)} g LEFT JOIN UC_centroids c ON g.${field(table, 'ID_UC_G0')} = c.${field('UC_centroids', 'ID_UC_G0')}`,
      )
      .all();
    const clean = (value) =>
      String(value ?? '')
        .replace(/^\uFEFF/, '')
        .trim();
    const cities = [];
    for (const row of rows) {
      const id = Number(clean(row.id));
      const population = Number(clean(row.population));
      if (
        !Number.isInteger(id) ||
        id <= 0 ||
        !Number.isFinite(population) ||
        population <= 0
      )
        throw new Error(`Invalid GHSL city id or population: ${row.id}`);
      if (population < minPopulation) continue;
      if (!row.centroid)
        throw new Error(`GHSL city ${id} has no official UC_centroids record`);
      const polygon = mollweideGeometry(geoPackageGeometry(row.polygon));
      const centroid = mollweideGeometry(geoPackageGeometry(row.centroid));
      if (centroid.type !== 'Point')
        throw new Error(`GHSL city ${id} has no point centroid`);
      const [longitude, latitude] = centroid.coordinates;
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      )
        throw new Error(`Invalid GHSL centroid ${id}`);
      cities.push({
        id,
        population,
        sourceName: clean(row.name),
        countryName: clean(row.country),
        point: { latitude, longitude },
        polygon,
      });
    }
    cities.sort((left, right) => left.id - right.id);
    if (new Set(cities.map((city) => city.id)).size !== cities.length)
      throw new Error('Duplicate GHSL city id');
    return cities.map((city, index) => ({ ...city, ownerIndex: index + 1 }));
  } finally {
    database.close();
  }
}

export async function loadFixedSources({
  cacheDirectory,
  ghslZip,
  populationZip,
  usePopulation = true,
}) {
  const ghslArchive = await pinnedFile(
    GHSL_SOURCE,
    ghslZip ?? join(cacheDirectory, 'ghsl.zip'),
  );
  const ghslPath = await extractZipMember(
    ghslArchive,
    join(cacheDirectory, `ghsl-${GHSL_SOURCE.sha256.slice(0, 12)}.gpkg`),
    /^GHS_UCDB_GLOBE_R2024A\.gpkg$/,
  );
  const countries = {};
  for (const [kind, source] of Object.entries(COUNTRY_SOURCES)) {
    const path = await pinnedFile(
      source,
      join(cacheDirectory, `countries-${kind}.geojson`),
    );
    countries[kind] = JSON.parse(await readFile(path, 'utf8'));
  }
  let populationPath = null;
  if (usePopulation) {
    const archive = await pinnedFile(
      POPULATION_SOURCE,
      populationZip ?? join(cacheDirectory, 'population.zip'),
    );
    populationPath = await extractZipMember(
      archive,
      join(
        cacheDirectory,
        `population-${POPULATION_SOURCE.sha256.slice(0, 12)}.tif`,
      ),
      /^GHS_POP_E2020_GLOBE_R2023A_4326_30ss_V1_0\.tif$/,
    );
  }
  return { ghslPath, countries, populationPath };
}

export async function loadMapGrid({
  grid,
  cacheDirectory,
  capturePath,
  capture = false,
  onProgress = () => {},
  fetchImplementation = fetch,
}) {
  const requests = tileRequests(grid);
  let pinned = null;
  try {
    pinned = JSON.parse(await readFile(capturePath, 'utf8'));
    if (
      pinned.schemaVersion !== 1 ||
      !Array.isArray(pinned.tiles) ||
      JSON.stringify(pinned.grid) !== JSON.stringify(grid)
    )
      throw new Error('Invalid MAP immutable capture or grid');
  } catch (error) {
    if (!capture || error.code !== 'ENOENT') throw error;
  }
  if (!capture && (!pinned.complete || pinned.tiles.length !== requests.length))
    throw new Error(
      'MAP capture is incomplete; resume capture before building production assets',
    );
  const expected = new Map(pinned?.tiles.map((tile) => [tile.id, tile]) ?? []);
  const friction = new Float32Array(grid.width * grid.height).fill(NaN);
  const land = new Uint8Array(friction.length);
  const landFraction = new Float32Array(friction.length);
  const identities = [];
  const directory = join(cacheDirectory, 'map-aggregated');
  await mkdir(directory, { recursive: true });
  const persistCapture = async (complete) => {
    const record = {
      schemaVersion: 1,
      retrievedAt: pinned?.retrievedAt ?? new Date().toISOString(),
      grid,
      coverageId: 'Accessibility__202001_Global_Motorized_Friction_Surface',
      complete,
      tiles: identities,
    };
    if (capture) {
      await mkdir(dirname(capturePath), { recursive: true });
      const temporary = `${capturePath}.checkpoint-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
      await rename(temporary, capturePath);
    }
    return record;
  };
  const download = async (request) => {
    const response = await fetchImplementation(request.url);
    if (!response.ok)
      throw new Error(`MAP request ${request.id} failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  };
  for (let number = 0; number < requests.length; number += 1) {
    const request = requests[number];
    const prior = expected.get(request.id);
    let aggregate = null;
    let identity = prior;
    if (prior?.aggregates && prior.fineLand && prior.url === request.url) {
      try {
        const buffers = await Promise.all(
          ['friction', 'land', 'landFraction'].map((kind) =>
            readFile(join(directory, `${request.id}.${kind}.bin`)),
          ),
        );
        for (let index = 0; index < buffers.length; index += 1) {
          const kind = ['friction', 'land', 'landFraction'][index];
          if (
            sha256(buffers[index]) !== prior.aggregates[kind].sha256 ||
            buffers[index].length !== prior.aggregates[kind].rawBytes
          )
            throw new Error(
              `MAP aggregate cache SHA-256 mismatch: ${request.id}/${kind}`,
            );
        }
        const fine = await readFile(
          join(directory, `${request.id}.fine-land.bin`),
        );
        if (
          sha256(fine) !== prior.fineLand.sha256 ||
          fine.length !== prior.fineLand.rawBytes
        )
          throw new Error(
            `MAP fine-land cache SHA-256 mismatch: ${request.id}`,
          );
        const floating = (bytes) =>
          Float32Array.from({ length: bytes.length / 4 }, (_, index) =>
            bytes.readFloatLE(index * 4),
          );
        aggregate = {
          width: prior.width / 4,
          height: prior.height / 4,
          friction: floating(buffers[0]),
          land: new Uint8Array(buffers[1]),
          landFraction: floating(buffers[2]),
        };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (!aggregate) {
      const raw = await download(request);
      const decoded = await decodeMapTiff(raw, request);
      identity = {
        id: request.id,
        url: request.url,
        bounds: request.bounds,
        width: decoded.width,
        height: decoded.height,
        rawBytes: raw.length,
        responseSha256: sha256(raw),
        hashKind: 'decoded-float32-le',
        sha256: pixelSha256(decoded.values),
      };
      if (capture && number === 0 && !prior) {
        const again = await download(request);
        const repeated = await decodeMapTiff(again, request);
        if (pixelSha256(repeated.values) !== identity.sha256)
          throw new Error(
            'Repeated MAP request returned different decoded pixels; capture aborted',
          );
        identity.repeatResponseBytesIdentical =
          sha256(again) === identity.responseSha256;
      }
      if (prior) verifyMapIdentity(identity, prior);
      else if (!capture) verifyMapIdentity(identity, null);
      aggregate = aggregateFriction(
        decoded.values,
        decoded.width,
        decoded.height,
      );
      const fineLand = packFineLand(decoded.values);
      identity.fineLand = {
        path: `${request.id}.fine-land.bin`,
        sha256: sha256(fineLand),
        rawBytes: fineLand.length,
        encoding: 'row-major packed bits, bit 0 first, 1=valid nonwater pixel',
      };
      await writeFile(join(directory, identity.fineLand.path), fineLand);
      identity.aggregates = {};
      for (const kind of ['friction', 'land', 'landFraction']) {
        const values = aggregate[kind];
        const bytes =
          kind === 'land'
            ? Buffer.from(values)
            : Buffer.alloc(values.length * 4);
        if (kind !== 'land')
          for (let index = 0; index < values.length; index += 1)
            bytes.writeFloatLE(values[index], index * 4);
        identity.aggregates[kind] = {
          sha256: sha256(bytes),
          rawBytes: bytes.length,
        };
        await writeFile(join(directory, `${request.id}.${kind}.bin`), bytes);
      }
    }
    const rowOffset = Math.round(
      (grid.north - request.bounds.north) / grid.step,
    );
    const columnOffset = Math.round(
      (request.bounds.west - grid.west) / grid.step,
    );
    for (let row = 0; row < aggregate.height; row += 1) {
      const destination = (row + rowOffset) * grid.width + columnOffset;
      friction.set(
        aggregate.friction.subarray(
          row * aggregate.width,
          (row + 1) * aggregate.width,
        ),
        destination,
      );
      land.set(
        aggregate.land.subarray(
          row * aggregate.width,
          (row + 1) * aggregate.width,
        ),
        destination,
      );
      landFraction.set(
        aggregate.landFraction.subarray(
          row * aggregate.width,
          (row + 1) * aggregate.width,
        ),
        destination,
      );
    }
    identities.push(identity);
    await persistCapture(false);
    onProgress({ stage: 'map', completed: number + 1, total: requests.length });
  }
  const record = await persistCapture(true);
  return { friction, land, landFraction, capture: capture ? record : pinned };
}
