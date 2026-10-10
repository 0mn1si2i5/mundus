import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  decodeUnits,
  decodeValues,
} from '../../src/features/reshaped/metadata.mjs';
import { SOURCES } from './sources.mjs';
import {
  EXCEPTION_COUNTRY_IDS,
  MERGE_INTO,
} from '../build-mundus-countries.mjs';

/** Exact identifiers and the existing Mundus English wording; no name matching. */
export function countryNamesFromSource(countries, defaultView) {
  const names = new Map();
  for (const feature of defaultView.features) {
    const p = feature.properties;
    if (MERGE_INTO[p.ADM0_A3]) continue;
    const id =
      EXCEPTION_COUNTRY_IDS[p.ADM0_A3] ??
      `ne-${String(p.ISO_N3_EH).padStart(3, '0')}`;
    names.set(id, p.NAME_ZH);
  }
  return new Map(
    countries.map((country) => {
      const zh =
        country.id === 'ne-156'
          ? '中国'
          : country.id === 'ne-158'
            ? '台湾'
            : names.get(country.id);
      if (!country.name.en || typeof zh !== 'string' || !zh.trim())
        throw new Error(`Missing country display name: ${country.id}`);
      return [country.id, { en: country.name.en, zh }];
    }),
  );
}

export async function loadCountryNames(cacheDir, countries) {
  const source = SOURCES.default;
  const bytes = await readFile(join(cacheDir, source.fileName));
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
    throw new Error('Country name source SHA-256 mismatch');
  return countryNamesFromSource(countries, JSON.parse(bytes));
}

/** Country records are small enough to retain lossless JSON numbers. */
export function encodeUnits(classification, countryNames) {
  const units = classification.countries.map((u, i) => {
    if (u.paletteIndex !== i + 1)
      throw new Error('Country palette order mismatch');
    return {
      id: u.id,
      name: countryNames?.get(u.id) ?? u.name,
      areaKm2: u.areaKm2,
      representativePoint: u.representativePoint,
      paletteIndex: i + 1,
      rasterId: i + 1,
      excluded: u.excluded,
    };
  });
  const asset = {
    formatVersion: 4,
    encoding: 'country-json',
    year: 2020,
    units,
  };
  decodeUnits(asset);
  return asset;
}
export function encodeValues(
  classification,
  metrics,
  fields,
  countryNames,
  publishedMetrics = Object.keys(metrics),
) {
  const keys = publishedMetrics;
  const totals = Object.fromEntries(
    keys.map((key) => [key, metrics[key].diagnostics.assignedTotal]),
  );
  const rows = classification.countries.map((u) => {
    const values = {},
      worldShare = {},
      areaRatio = {},
      padding = {};
    for (const key of keys) {
      const value = metrics[key].countryValues[u.paletteIndex];
      values[key] = value;
      worldShare[key] =
        value === null || u.excluded ? null : value / totals[key];
      areaRatio[key] =
        value === null || u.excluded
          ? null
          : (fields[key].effectiveAreas ?? fields[key].actualAreas)[
              u.paletteIndex
            ] / fields[key].trueAreas[u.paletteIndex];
      padding[key] =
        fields[key].padding?.countries.find(
          (entry) => entry.paletteIndex === u.paletteIndex,
        ) ?? null;
    }
    return { id: u.id, values, worldShare, areaRatio, padding, year: 2020 };
  });
  const asset = {
    formatVersion: 4,
    encoding: 'country-json',
    year: 2020,
    metrics: keys,
    sourceIds: Object.fromEntries(keys.map((k) => [k, SOURCES[k].id])),
    totals,
    rows,
  };
  decodeValues(asset, decodeUnits(encodeUnits(classification, countryNames)));
  return asset;
}
