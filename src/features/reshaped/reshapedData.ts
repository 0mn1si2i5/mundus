import manifest from '../../data/manifests/reshaped-earth.json';
import type { ReshapedLevelId, ReshapedMetricId } from './metrics';
import { decodePngRgb } from './pngCore.mjs';
import { decodeInverse, type InverseField } from './inverseFormat.mjs';
import { decodeUnits, decodeValues } from './metadata.mjs';
import { getRuntimeQualityProfile } from '../globe/quality';

export { decodePngRgb } from './pngCore.mjs';
export interface ReshapedUnit {
  id: string;
  rasterId: number;
  level: ReshapedLevelId;
  parentCountryId: string;
  name: { zh: string | null; en: string };
  areaKm2: number;
  representativePoint: { latitude: number; longitude: number } | null;
  paletteIndex: number;
  excluded?: boolean;
}
export interface ReshapedValueRow {
  id: string;
  level: ReshapedLevelId;
  values: Record<ReshapedMetricId, number | null>;
  worldShare: Record<ReshapedMetricId, number | null>;
  areaRatio: Record<ReshapedMetricId, number | null>;
  year: number;
}
export interface DecodedIdRaster {
  width: number;
  height: number;
  ids: Uint32Array;
}
export interface ReshapedDataset {
  units: readonly ReshapedUnit[];
  unitsById: ReadonlyMap<string, ReshapedUnit>;
  unitsByRasterId: ReadonlyMap<number, ReshapedUnit>;
  values: ReadonlyMap<string, ReshapedValueRow>;
  ids: DecodedIdRaster | null;
  inverse: InverseField | null;
  graphicsUnavailable: boolean;
  metric: ReshapedMetricId;
  level: ReshapedLevelId;
}

// A literal glob lets Vite emit and rewrite every asset URL, without fetching
// any asset until this mode is entered.
const urls = import.meta.glob('../../data/generated/reshaped-earth/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const cache = new Map<
  string,
  { promise: Promise<ReshapedDataset>; signal?: AbortSignal }
>();
async function asset(name: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const expected = (
    manifest.derivedAssets as Record<
      string,
      { sha256: string; rawBytes: number }
    >
  )[name];
  const url = urls[`../../data/generated/reshaped-earth/${name}`];
  if (!expected || !url)
    throw new Error(`Unknown Reshaped Earth asset: ${name}`);
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`Reshaped Earth request failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== expected.rawBytes)
    throw new Error(`Asset size mismatch: ${name}`);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hash = [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  if (hash !== expected.sha256) throw new Error(`Asset hash mismatch: ${name}`);
  return buffer;
}
const json = async (name: string, signal?: AbortSignal): Promise<unknown> =>
  JSON.parse(new TextDecoder().decode(await asset(name, signal)));
export function loadReshapedData(
  metric: ReshapedMetricId,
  level: ReshapedLevelId,
  signal?: AbortSignal,
): Promise<ReshapedDataset> {
  const key = `${metric}:${level}`;
  const existing = cache.get(key);
  if (existing && !existing.signal?.aborted) return existing.promise;
  const entry: { promise: Promise<ReshapedDataset>; signal?: AbortSignal } = {
    promise: Promise.resolve(null as unknown as ReshapedDataset),
    signal,
  };
  entry.promise = (async () => {
    if (!('formatVersion' in manifest) || manifest.formatVersion !== 1)
      throw new Error(
        'Reshaped Earth production assets have not been published',
      );
    const [unitAsset, valueAsset] = await Promise.all([
      json('units.json', signal),
      json('values.json', signal),
    ]);
    const units = decodeUnits(unitAsset);
    const rows = decodeValues(valueAsset, units);
    const activeUnits = units.filter((u) => u.level === level);
    const graphicsUnavailable = typeof DecompressionStream === 'undefined';
    let ids: DecodedIdRaster | null = null,
      inverse: InverseField | null = null;
    if (!graphicsUnavailable) {
      [ids, inverse] = await Promise.all([
        asset(`ids-${level}.png`, signal).then(decodePngRgb),
        asset(`inverse-${metric}-${level}.bin`, signal).then((buffer) =>
          decodeInverse(buffer, { metric, level }),
        ),
      ]);
      if (ids.width !== 4096 || ids.height !== 2048)
        throw new Error('Invalid Reshaped Earth ID raster dimensions');
      ids = displayIdRaster(ids, getRuntimeQualityProfile().level === 'low');
    }
    return {
      units,
      unitsById: new Map(units.map((u) => [u.id, u])),
      unitsByRasterId: new Map(activeUnits.map((u) => [u.rasterId, u])),
      values: new Map(
        rows.filter((row) => row.level === level).map((row) => [row.id, row]),
      ),
      ids,
      inverse,
      graphicsUnavailable,
      metric,
      level,
    };
  })().catch((error: unknown) => {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  });
  cache.set(key, entry);
  while (cache.size > 2) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return entry.promise;
}
/** This shared raster drives GPU upload, picking and restored-point results. */
export function displayIdRaster(
  raster: DecodedIdRaster,
  low: boolean,
): DecodedIdRaster {
  if (!low) return raster;
  const width = raster.width / 2,
    height = raster.height / 2;
  if (!Number.isInteger(width) || !Number.isInteger(height))
    throw new Error('Invalid Reshaped Earth low-resolution ID raster');
  const ids = new Uint32Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      ids[y * width + x] = raster.ids[(y * 2 + 1) * raster.width + x * 2 + 1]!;
  return { width, height, ids };
}
export function sampleReshapedId(
  raster: DecodedIdRaster | null,
  latitude: number,
  longitude: number,
): number {
  if (!raster) return 0;
  const x = Math.floor(
    (((((longitude + 180) % 360) + 360) % 360) / 360) * raster.width,
  );
  const y = Math.min(
    raster.height - 1,
    Math.max(0, Math.floor(((90 - latitude) / 180) * raster.height)),
  );
  return raster.ids[y * raster.width + x] ?? 0;
}
export const decodeRgbId = (red: number, green: number, blue: number) =>
  red * 65536 + green * 256 + blue;
