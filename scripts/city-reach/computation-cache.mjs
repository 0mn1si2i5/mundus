import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { endianness } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sha256 } from './friction.mjs';
import { LEVELS } from './config.mjs';
import { validateGrid } from './grid.mjs';

const MODEL_FILES = [
  'config',
  'friction',
  'geometry',
  'grid',
  'policy',
  'prepare',
  'solver',
  'sources',
  'fine-waterways',
];

export async function computationIdentity(grid, capture, benchmark = false) {
  if (
    !capture?.complete ||
    JSON.stringify(capture.grid) !== JSON.stringify(grid)
  )
    throw new Error(
      'Complete matching MAP source capture required for computation identity',
    );
  const code = [];
  for (const file of MODEL_FILES) {
    const bytes = await readFile(
      fileURLToPath(new URL(`./${file}.mjs`, import.meta.url)),
    );
    code.push([file, sha256(bytes)]);
  }
  code.push([
    'entrypoint',
    sha256(
      await readFile(
        fileURLToPath(new URL('../build-city-reach.mjs', import.meta.url)),
      ),
    ),
  ]);
  return sha256(
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        grid,
        benchmark,
        map: capture.tiles.map(({ id, url, sha256: sourceHash, fineLand }) => ({
          id,
          url,
          sourceHash,
          fineLandHash: fineLand?.sha256,
        })),
        code,
      }),
    ),
  );
}

function uint16Bytes(values) {
  if (endianness() === 'LE')
    return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
  return bytes;
}

export async function saveComputation(cacheDirectory, identity, computation) {
  if (!/^[a-f0-9]{64}$/.test(identity))
    throw new Error('Invalid computation cache identity');
  const directory = join(cacheDirectory, `computed-${identity}`);
  await mkdir(directory, { recursive: true });
  const metadata = {
    schemaVersion: 1,
    grid: computation.grid,
    cities: computation.cities.map(({ sourceCells, ...city }) => {
      void sourceCells;
      return city;
    }),
    thresholds: [...computation.thresholds],
    requiredIds: [...computation.requiredIds],
    mapCapture: computation.mapCapture,
    waterwaysAudit: computation.waterwaysAudit,
    report: computation.report,
  };
  const files = [];
  const persist = async (name, bytes) => {
    const temporary = join(directory, `${name}.new-${process.pid}`);
    await writeFile(temporary, bytes);
    await rename(temporary, join(directory, name));
    files.push({ name, sha256: sha256(bytes), rawBytes: bytes.length });
  };
  await persist('metadata.json', Buffer.from(`${JSON.stringify(metadata)}\n`));
  await persist('disputed.u8', Buffer.from(computation.disputed));
  await persist('density.u8', Buffer.from(computation.density));
  for (const [level, owners] of computation.levelOwners)
    await persist(`owners-${level}.u16le`, uint16Bytes(owners));
  const marker = { schemaVersion: 1, complete: true, identity, files };
  const temporary = join(directory, `complete.json.new-${process.pid}`);
  await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`);
  await rename(temporary, join(directory, 'complete.json'));
  return directory;
}

export async function loadComputation(cacheDirectory, identity) {
  if (!/^[a-f0-9]{64}$/.test(identity))
    throw new Error('Invalid computation cache identity');
  const directory = join(cacheDirectory, `computed-${identity}`);
  let marker;
  try {
    marker = JSON.parse(
      await readFile(join(directory, 'complete.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (
    marker.schemaVersion !== 1 ||
    marker.complete !== true ||
    marker.identity !== identity ||
    !Array.isArray(marker.files)
  )
    throw new Error('Invalid or incomplete city-reach computation cache');
  const content = new Map();
  for (const file of marker.files) {
    if (
      !/^(metadata\.json|disputed\.u8|density\.u8|owners-(0\.25|0\.5|1|2|4|8|16)\.u16le)$/.test(
        file.name,
      ) ||
      content.has(file.name)
    )
      throw new Error('Invalid or duplicate computation cache file');
    const bytes = await readFile(join(directory, file.name));
    if (bytes.length !== file.rawBytes || sha256(bytes) !== file.sha256)
      throw new Error(`Computation cache SHA-256 mismatch: ${file.name}`);
    content.set(file.name, bytes);
  }
  if (
    content.size !== 10 ||
    !content.has('metadata.json') ||
    !content.has('density.u8') ||
    !content.has('disputed.u8')
  )
    throw new Error('Incomplete city-reach computation asset set');
  const metadata = JSON.parse(content.get('metadata.json').toString('utf8'));
  validateGrid(metadata.grid);
  const size = metadata.grid.width * metadata.grid.height;
  if (
    metadata.schemaVersion !== 1 ||
    content.get('density.u8').length !== size ||
    content.get('disputed.u8').length !== size
  )
    throw new Error('Invalid city-reach computation dimensions');
  if (
    !Array.isArray(metadata.cities) ||
    !metadata.cities.length ||
    !Array.isArray(metadata.thresholds) ||
    metadata.thresholds.length !== metadata.cities.length ||
    !Array.isArray(metadata.requiredIds) ||
    !metadata.mapCapture?.complete ||
    JSON.stringify(metadata.mapCapture.grid) !== JSON.stringify(metadata.grid)
  )
    throw new Error('Invalid city-reach computation metadata');
  const cityIds = new Set(metadata.cities.map((city) => city.id));
  if (
    cityIds.size !== metadata.cities.length ||
    metadata.requiredIds.some((id) => !cityIds.has(id)) ||
    metadata.thresholds.some(([id]) => !cityIds.has(id)) ||
    new Set(metadata.thresholds.map(([id]) => id)).size !== cityIds.size
  )
    throw new Error('Invalid cached city identities');
  const levelOwners = new Map();
  for (const level of LEVELS) {
    const bytes = content.get(`owners-${level}.u16le`);
    if (!bytes || bytes.length !== size * 2)
      throw new Error('Invalid cached owner dimensions');
    const owners = new Uint16Array(size);
    if (endianness() === 'LE') new Uint8Array(owners.buffer).set(bytes);
    else
      for (let index = 0; index < size; index += 1)
        owners[index] = bytes.readUInt16LE(index * 2);
    if (owners.some((owner) => owner > metadata.cities.length))
      throw new Error('Invalid cached owner index');
    levelOwners.set(level, owners);
    content.delete(`owners-${level}.u16le`);
  }
  return {
    ...metadata,
    thresholds: new Map(metadata.thresholds),
    requiredIds: new Set(metadata.requiredIds),
    levelOwners,
    disputed: new Uint8Array(content.get('disputed.u8')),
    density: new Uint8Array(content.get('density.u8')),
    reusedCache: true,
  };
}
