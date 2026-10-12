import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAP_COVERAGE, tileRequests } from './config.mjs';
import { waterwaySourceDigest } from './fine-waterways.mjs';
import { sha256 } from './friction.mjs';

const hash = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function validateSourceCapture(capture, grid) {
  const requests = tileRequests(grid);
  if (
    capture?.schemaVersion !== 1 ||
    capture.map?.schemaVersion !== 1 ||
    !capture.map.complete ||
    capture.map.coverageId !== MAP_COVERAGE ||
    capture.map.tiles?.length !== requests.length ||
    JSON.stringify(capture.map.grid) !== JSON.stringify(grid)
  )
    throw new Error('City-reach MAP source capture is incomplete');
  const identities = new Map(capture.map.tiles.map((tile) => [tile.id, tile]));
  for (const request of requests) {
    const identity = identities.get(request.id);
    const width = Math.round((request.bounds.east - request.bounds.west) * 120);
    const height = Math.round(
      (request.bounds.north - request.bounds.south) * 120,
    );
    if (
      !identity ||
      identity.url !== request.url ||
      JSON.stringify(identity.bounds) !== JSON.stringify(request.bounds) ||
      identity.width !== width ||
      identity.height !== height ||
      !hash(identity.sha256) ||
      identity.hashKind !== 'decoded-float32-le' ||
      !hash(identity.responseSha256) ||
      !hash(identity.fineLand?.sha256) ||
      identity.fineLand.rawBytes !== Math.ceil((width * height) / 8) ||
      identity.fineLand.encoding !==
        'row-major packed bits, bit 0 first, 1=valid nonwater pixel'
    )
      throw new Error(`Invalid MAP tile identity ${request.id}`);
  }
  const audit = capture.narrowWaterwaysAudit;
  if (
    audit?.schemaVersion !== 1 ||
    audit.reviewed !== true ||
    !Array.isArray(audit.connections) ||
    audit.sourceDigest !== waterwaySourceDigest(grid, capture.map)
  )
    throw new Error(
      'City-reach narrow-waterway review is missing or belongs to different sources',
    );
  return capture;
}

export function validateSourceSummary(summary, grid) {
  const audit = summary?.narrowWaterwaysAudit;
  if (
    summary?.schemaVersion !== 2 ||
    !hash(summary.fullCapture?.sha256) ||
    !Number.isInteger(summary.fullCapture.rawBytes) ||
    summary.fullCapture.rawBytes <= 0 ||
    summary.map?.coverageId !== MAP_COVERAGE ||
    summary.map.tileCount !== tileRequests(grid).length ||
    JSON.stringify(summary.map.grid) !== JSON.stringify(grid) ||
    !hash(summary.map.sha256) ||
    audit?.schemaVersion !== 1 ||
    audit.reviewed !== true ||
    !hash(audit.sourceDigest) ||
    !hash(audit.sha256) ||
    !hash(audit.connectionsSha256) ||
    [
      'connectionCount',
      'fineComponentCount',
      'coarseLandCells',
      'mixedCoarseCells',
    ].some((field) => !Number.isInteger(audit[field]) || audit[field] < 0) ||
    !Array.isArray(summary.requiredCityIds) ||
    summary.requiredCityIds.some(
      (id, index, ids) =>
        !Number.isInteger(id) || id <= 0 || (index > 0 && ids[index - 1] >= id),
    )
  )
    throw new Error('Invalid city-reach source summary or reviewed identity');
  return summary;
}

/** Full approval is verified before producing the small distributable record. */
export async function archiveAndSummarizeCapture(
  capture,
  grid,
  requiredIds,
  directory,
) {
  validateSourceCapture(capture, grid);
  if (!directory)
    throw new Error('External source-capture archive directory is required');
  const bytes = Buffer.from(`${JSON.stringify(capture)}\n`);
  const captureHash = sha256(bytes);
  const archivePath = join(directory, `source-capture-${captureHash}.json`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(archivePath, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (sha256(await readFile(archivePath)) !== captureHash)
      throw new Error('Archived city-reach source capture SHA-256 mismatch');
  }
  const audit = capture.narrowWaterwaysAudit;
  const summary = validateSourceSummary(
    {
      schemaVersion: 2,
      fullCapture: { sha256: captureHash, rawBytes: bytes.length },
      map: {
        coverageId: capture.map.coverageId,
        grid,
        tileCount: capture.map.tiles.length,
        sha256: sha256(Buffer.from(JSON.stringify(capture.map))),
      },
      narrowWaterwaysAudit: {
        schemaVersion: audit.schemaVersion,
        reviewed: audit.reviewed,
        sourceDigest: audit.sourceDigest,
        sha256: sha256(Buffer.from(JSON.stringify(audit))),
        connectionsSha256: sha256(
          Buffer.from(JSON.stringify(audit.connections)),
        ),
        connectionCount: audit.connections.length,
        fineComponentCount: audit.fineComponentCount ?? 0,
        coarseLandCells: audit.coarseLandCells ?? 0,
        mixedCoarseCells: audit.mixedCoarseCells ?? 0,
      },
      requiredCityIds: [...requiredIds].sort((a, b) => a - b),
    },
    grid,
  );
  return { summary, archivePath };
}
