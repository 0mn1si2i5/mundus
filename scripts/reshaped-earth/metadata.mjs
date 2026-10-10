import {
  AREA_RATIO_LOG2_SCALE,
  decodeUnits,
  decodeValues,
} from '../../src/features/reshaped/metadata.mjs';
import { SOURCES } from './sources.mjs';

export function encodeNumericColumn(values, bytes, kind) {
  const buffer = Buffer.alloc(values.length * bytes);
  for (let i = 0; i < values.length; i += 1) buffer[kind](values[i], i * bytes);
  const shuffled = Buffer.alloc(buffer.length);
  for (let byte = 0; byte < bytes; byte += 1)
    for (let i = 0; i < values.length; i += 1)
      shuffled[byte * values.length + i] = buffer[i * bytes + byte];
  return shuffled.toString('base64');
}

export function encodeUnits(classification) {
  const { units: admins, countries } = classification;
  const all = [...admins, ...countries];
  const parents = new Map(countries.map((u, i) => [u.id, i]));
  for (const collection of [admins, countries])
    collection.forEach((u, i) => {
      if (u.paletteIndex !== i + 1)
        throw new Error('Unit palette order mismatch');
    });
  const asset = {
    formatVersion: 1,
    encoding: 'columns-shuffled-le',
    countryNames: 'mundus-countries',
    countries: countries.map((u) => u.id),
    codes: admins.map((u) => u.id.slice(u.parentCountryId.length + 1)),
    parent: admins.map((u) => parents.get(u.parentCountryId)),
    en: admins.map((u) => u.name.en),
    zh: admins.map((u) => u.name.zh),
    areaKm2: encodeNumericColumn(
      all.map((u) => u.areaKm2),
      8,
      'writeDoubleLE',
    ),
    pointPixels: encodeNumericColumn(
      all.map((u) => {
        const p = u.representativePoint;
        if (!p) return 0xffffffff;
        const x = Math.round((p.longitude + 180) * 120 - 0.5);
        const y = Math.round((90 - p.latitude) * 120 - 0.5);
        return y * 43200 + x;
      }),
      4,
      'writeUInt32LE',
    ),
    excluded: all.flatMap((u, i) => (u.excluded ? [i] : [])),
  };
  decodeUnits(asset);
  return asset;
}

/** Metric values and true areas are lossless Float64. Only the displayed
 * measured area ratio is quantized, to <=0.034% relative error. Acceptance
 * uses the original unquantized per-unit measurements. */
export function encodeValues(classification, metrics, fields) {
  const all = [...classification.units, ...classification.countries];
  const keys = Object.keys(metrics);
  const asset = {
    formatVersion: 1,
    encoding: 'columns-shuffled-le',
    year: 2020,
    metrics: keys,
    sourceIds: Object.fromEntries(keys.map((k) => [k, SOURCES[k].id])),
    values: {},
    totals: {},
    areaRatio: {},
    areaRatioLog2Scale: AREA_RATIO_LOG2_SCALE,
  };
  for (const key of keys) {
    asset.values[key] = encodeNumericColumn(
      classification.units.map(
        (u) => metrics[key].values[u.paletteIndex] ?? NaN,
      ),
      8,
      'writeDoubleLE',
    );
    asset.totals[key] = metrics[key].diagnostics.assignedTotal;
    asset.areaRatio[key] = encodeNumericColumn(
      all.map((u) => {
        const value = (
          u.level === 'admin1'
            ? metrics[key].values
            : metrics[key].countryValues
        )[u.paletteIndex];
        if (value == null || u.excluded) return 0;
        const field = fields[`${key}-${u.level}`];
        const ratio =
          field.actualAreas[u.paletteIndex] / field.trueAreas[u.paletteIndex];
        const code =
          Math.round(Math.log2(ratio) * AREA_RATIO_LOG2_SCALE) + 32768;
        if (!(ratio > 0) || code < 1 || code > 65535)
          throw new Error('Area ratio outside encoding range');
        return code;
      }),
      2,
      'writeUInt16LE',
    );
  }
  decodeValues(asset, decodeUnits(encodeUnits(classification)));
  return asset;
}
