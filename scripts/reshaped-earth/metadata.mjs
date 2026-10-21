import { encodeValues as encodeValuesAsset } from '../../src/features/reshaped/metadata.mjs';
export { encodeUnits } from '../../src/features/reshaped/metadata.mjs';
import { COUNTRY_NAMES } from '../../src/features/globe/countryNames.ts';
import { SOURCES } from './sources.mjs';

/** Owner-reviewed Mundus country names by exact unit ID; no name matching. */
export function reviewedCountryNames(countries) {
  return new Map(
    countries.map((country) => {
      const name = COUNTRY_NAMES[country.id];
      if (!name || name.en !== country.name.en)
        throw new Error(`Missing reviewed country name: ${country.id}`);
      return [country.id, { en: country.name.en, zh: name.zh }];
    }),
  );
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
