import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeValues as encodeValuesAsset } from '../../src/features/reshaped/metadata.mjs';
export { encodeUnits } from '../../src/features/reshaped/metadata.mjs';
import { SOURCES } from './sources.mjs';
import {
  EXCEPTION_COUNTRY_IDS,
  MERGE_INTO,
} from '../build-mundus-countries.mjs';

/** Exact identifiers and the existing Mundus English wording; no name matching. */
function countryNamesFromSource(countries, defaultView) {
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

/** I/O adapter: supply pinned source identities to the shared JSON codec. */
export function encodeValues(
  classification,
  metrics,
  fields,
  countryNames,
  publishedMetrics = Object.keys(metrics),
) {
  return encodeValuesAsset(
    classification,
    metrics,
    fields,
    countryNames,
    publishedMetrics,
    Object.fromEntries(publishedMetrics.map((key) => [key, SOURCES[key].id])),
  );
}

// Internal production paths exposed only for focused boundary tests.
export const __test = Object.freeze({
  countryNamesFromSource,
});
