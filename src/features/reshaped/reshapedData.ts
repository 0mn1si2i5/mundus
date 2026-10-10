import manifest from '../../data/manifests/reshaped-earth.json';
import unitsUrl from '../../data/generated/reshaped-earth/units.json?url';
import valuesUrl from '../../data/generated/reshaped-earth/values.json?url';
import idsUrl from '../../data/generated/reshaped-earth/ids-country.png?url';
import populationUrl from '../../data/generated/reshaped-earth/inverse-population.bin?url';
import gdpUrl from '../../data/generated/reshaped-earth/inverse-gdp.bin?url';
import co2Url from '../../data/generated/reshaped-earth/inverse-co2.bin?url';
import lightsUrl from '../../data/generated/reshaped-earth/inverse-lights.bin?url';
import { RESHAPED_METRIC_BITS, type ReshapedMetricId } from './metrics';
import { decodePngRgb } from './pngCore.mjs';
import { decodeInverse, type InverseField } from './inverseFormat.mjs';
import { decodeUnits, decodeValues } from './metadata.mjs';
import { getRuntimeQualityProfile } from '../globe/quality';
import { sampleReshapedLabel, type DecodedIdRaster } from './labelSampling.mjs';

export { sampleReshapedLabel } from './labelSampling.mjs';
export type {
  DecodedIdRaster,
  ReshapedRasterSample,
} from './labelSampling.mjs';

export { decodePngRgb } from './pngCore.mjs';
export interface ReshapedUnit {
  id: string;
  rasterId: number;
  name: { zh: string | null; en: string };
  areaKm2: number;
  representativePoint: { latitude: number; longitude: number } | null;
  paletteIndex: number;
  excluded?: boolean;
}
export interface ReshapedValueRow {
  id: string;
  values: Record<ReshapedMetricId, number | null>;
  worldShare: Record<ReshapedMetricId, number | null>;
  areaRatio: Record<ReshapedMetricId, number | null>;
  padding?: Partial<
    Record<
      ReshapedMetricId,
      {
        id: string;
        paletteIndex: number;
        actualArea: number;
        targetArea: number;
        coreArea: number;
        rasterActualArea: number;
        paddingArea: number;
        paddingFraction: number;
        onePixelRelativeError: number;
      } | null
    >
  >;
  year: number;
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
}

// These rewritten URLs live in the lazy mode chunk. Fetching an asset remains
// explicit, so the lobby and other observations load no cartogram data.
const urls: Record<string, string> = {
  'units.json': unitsUrl,
  'values.json': valuesUrl,
  'ids-country.png': idsUrl,
  'inverse-population.bin': populationUrl,
  'inverse-gdp.bin': gdpUrl,
  'inverse-co2.bin': co2Url,
  'inverse-lights.bin': lightsUrl,
};
async function asset(name: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const expected = (
    manifest.derivedAssets as Record<
      string,
      { sha256: string; rawBytes: number }
    >
  )[name];
  const url = urls[name];
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
export async function loadReshapedData(
  metric: ReshapedMetricId,
  signal?: AbortSignal,
  previous?: ReshapedDataset,
): Promise<ReshapedDataset> {
  if (!('formatVersion' in manifest) || manifest.formatVersion !== 5)
    throw new Error('Reshaped Earth production assets have not been published');
  let units = previous?.units;
  let values = previous?.values;
  if (!units || !values) {
    const [unitAsset, valueAsset] = await Promise.all([
      json('units.json', signal),
      json('values.json', signal),
    ]);
    units = decodeUnits(unitAsset);
    values = new Map(
      decodeValues(valueAsset, units).map((row) => [row.id, row]),
    );
  }
  const graphicsUnavailable = typeof DecompressionStream === 'undefined';
  let ids: DecodedIdRaster | null = previous?.ids ?? null,
    inverse: InverseField | null = null;
  if (!graphicsUnavailable) {
    [ids, inverse] = await Promise.all([
      ids
        ? Promise.resolve(ids)
        : asset('ids-country.png', signal).then(decodeCountryPaddingRaster),
      asset(`inverse-${metric}.bin`, signal).then((buffer) =>
        decodeInverse(buffer, { metric }),
      ),
    ]);
    if (!previous?.ids && (ids.width !== 4096 || ids.height !== 2048))
      throw new Error('Invalid Reshaped Earth ID raster dimensions');
    if (!previous?.ids)
      ids = displayIdRaster(ids, getRuntimeQualityProfile().level === 'low');
  }
  return {
    units,
    unitsById: previous?.unitsById ?? new Map(units.map((u) => [u.id, u])),
    unitsByRasterId:
      previous?.unitsByRasterId ?? new Map(units.map((u) => [u.rasterId, u])),
    values,
    ids,
    inverse,
    graphicsUnavailable,
    metric,
  };
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
  const padding = raster.padding ? new Uint8Array(width * height) : undefined;
  const distance = raster.distance ? new Uint8Array(width * height) : undefined;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const source = (y * 2 + 1) * raster.width + x * 2 + 1;
      ids[y * width + x] = raster.ids[source]!;
      if (padding) padding[y * width + x] = raster.padding![source]!;
      if (distance)
        distance[y * width + x] = Math.round(raster.distance![source]! / 2);
    }
  return {
    width,
    height,
    ids,
    padding,
    distance,
    ...(distance
      ? { distanceCap: Math.round((raster.distanceCap ?? 255) / 2) }
      : {}),
  };
}
export async function decodeCountryPaddingRaster(
  buffer: ArrayBuffer,
): Promise<DecodedIdRaster> {
  const raster = await decodePngRgb(buffer);
  const ids = new Uint32Array(raster.ids.length);
  const padding = new Uint8Array(ids.length);
  const distance = new Uint8Array(ids.length);
  for (let i = 0; i < ids.length; i += 1) {
    const pixel = raster.ids[i]!;
    const id = pixel >>> 16,
      bits = (pixel >>> 8) & 255;
    if (id > 239 || bits > 15 || (id === 0 && bits !== 0))
      throw new Error('Invalid country/padding PNG channels');
    ids[i] = id;
    padding[i] = bits;
    distance[i] = pixel & 255;
  }
  return { width: raster.width, height: raster.height, ids, padding, distance };
}

export function sampleReshapedPadding(
  raster: DecodedIdRaster | null,
  latitude: number,
  longitude: number,
  metric: ReshapedMetricId,
): boolean {
  if (!raster?.padding) return false;
  return (
    (sampleReshapedLabel(raster, latitude, longitude).padding &
      (1 << RESHAPED_METRIC_BITS[metric])) !==
    0
  );
}
export function sampleReshapedId(
  raster: DecodedIdRaster | null,
  latitude: number,
  longitude: number,
): number {
  return sampleReshapedLabel(raster, latitude, longitude).id;
}
