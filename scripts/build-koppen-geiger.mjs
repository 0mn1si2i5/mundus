// Build the Climate Twins class raster from a locally downloaded archive:
//   node scripts/build-koppen-geiger.mjs --archive <koppen_geiger_tif.zip> [--capture]
// Keep the archive outside the worktree. --capture prints its identity and
// legend for review and writes nothing.
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { KOPPEN_CLASSES } from '../src/features/climate/koppenClasses.ts';
import { SOURCE } from './koppen-geiger/source.mjs';
import {
  ASSET_PATH,
  MANIFEST_PATH,
  classesFromRaster,
  createManifest,
  encodeClassPng,
  landShares,
  parseLegend,
  sha256,
  verifyLegend,
} from './koppen-geiger/build.mjs';

const index = process.argv.indexOf('--archive');
const archive = index === -1 ? null : process.argv[index + 1];
if (!archive) throw new Error('Pass --archive <koppen_geiger_tif.zip>');
const capture = process.argv.includes('--capture');

const archiveBytes = await readFile(archive);
const archiveSha256 = sha256(archiveBytes);
const { stdout } = await promisify(execFile)('unzip', ['-Z1', archive], {
  maxBuffer: 4 * 1024 * 1024,
});
const members = stdout.split('\n').filter(Boolean);
const only = (pattern) => {
  const found = members.filter((member) => pattern.test(member));
  if (found.length !== 1)
    throw new Error(
      `Expected one member matching ${pattern}; found ${found.length}:\n${members.join('\n')}`,
    );
  return found[0];
};
const member = only(SOURCE.member);
const legendMember = only(SOURCE.legend);
const [tif, legendBytes] = await Promise.all([
  unzipMember(archive, member),
  unzipMember(archive, legendMember),
]);
const legend = parseLegend(legendBytes.toString('utf8'));
verifyLegend(legend, KOPPEN_CLASSES);

if (capture) {
  console.log(
    JSON.stringify(
      {
        fileName: SOURCE.fileName,
        bytes: (await stat(archive)).size,
        sha256: archiveSha256,
        member,
        memberSha256: sha256(tif),
        legendMember,
        legendSha256: sha256(legendBytes),
        legend,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!SOURCE.sha256 || !SOURCE.bytes || !SOURCE.retrievedAt)
  throw new Error('Pin the reviewed archive identity in source.mjs first');
if (archiveSha256 !== SOURCE.sha256 || archiveBytes.byteLength !== SOURCE.bytes)
  throw new Error(
    `Archive differs from the pinned source: ${archiveSha256}, ${archiveBytes.byteLength} bytes`,
  );

const { fromArrayBuffer } = await import('geotiff');
const image = await (
  await fromArrayBuffer(
    tif.buffer.slice(tif.byteOffset, tif.byteOffset + tif.byteLength),
  )
).getImage();
const [values] = await image.readRasters({ samples: [0] });
const raster = classesFromRaster({
  width: image.getWidth(),
  height: image.getHeight(),
  bbox: image.getBoundingBox(),
  values,
  noData: image.getGDALNoData(),
});
const png = encodeClassPng(raster);
const manifest = createManifest({
  source: SOURCE,
  capture: {
    member,
    memberSha256: sha256(tif),
    legendSha256: sha256(legendBytes),
  },
  raster,
  shares: landShares(raster),
  png,
});
await mkdir(dirname(ASSET_PATH), { recursive: true });
await writeFile(ASSET_PATH, png);
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Wrote ${ASSET_PATH} (${png.byteLength} bytes, ${manifest.derivedAsset.gzipBytes} gzip) and ${MANIFEST_PATH}`,
);

function unzipMember(path, name) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', path, name], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`unzip failed (${code}): ${stderr}`)),
    );
  });
}
