import { z } from 'zod';

const localFormSchema = z.object({
  value: z.string().min(1),
  script: z.string().min(1).nullable(),
});

const surnameRecordSchema = z.object({
  rank: z.number().int().positive().nullable(),
  observationKind: z
    .enum(['rank-one', 'source-listed', 'manual-observation'])
    .default('source-listed'),
  localForms: z.array(localFormSchema),
  romanizedForms: z.array(z.string().min(1)),
  zhDisplay: z.string().min(1).nullable(),
  zhMethod: z.enum(['reviewed', 'source', 'missing']),
  count: z.number().nonnegative().nullable(),
  share: z.number().min(0).max(1).nullable(),
  statYear: z.number().int().min(1900).max(2100).nullable(),
});

const surnameDatasetSchema = z.object({
  schemaVersion: z.literal(1),
  sourceSnapshot: z.string().min(1),
  sourceKind: z.literal('community'),
  sourceUrl: z.array(z.url()).min(1),
  license: z.string().min(1),
  coverageNote: z.string().min(1),
  countries: z.record(
    z.string().min(1),
    z.object({
      countryIso2: z.string().regex(/^[A-Z]{2}$/),
      // An empty source list is intentional for a country with no auditable
      // country-specific observation. Such countries must remain unlabelled.
      sourceUrls: z.array(z.url()),
      records: z.array(surnameRecordSchema),
    }),
  ),
});

export interface SurnameLocalForm {
  value: string;
  script: string | null;
}

export interface SurnameRecord {
  rank: number | null;
  observationKind?: 'rank-one' | 'source-listed' | 'manual-observation';
  localForms: readonly SurnameLocalForm[];
  romanizedForms: readonly string[];
  zhDisplay: string | null;
  zhMethod: 'reviewed' | 'source' | 'missing';
  count: number | null;
  share: number | null;
  statYear: number | null;
}

export interface SurnameCountry {
  countryId: string;
  countryIso2: string;
  sourceUrls: readonly string[];
  records: readonly SurnameRecord[];
  coverageStatus:
    'rank-one' | 'source-listed' | 'manual-observation' | 'no-source';
}

export interface SurnameDataset {
  sourceSnapshot: string;
  sourceKind: 'community';
  sourceUrl: readonly string[];
  license: string;
  coverageNote: string;
  countries: readonly SurnameCountry[];
  countriesById: ReadonlyMap<string, SurnameCountry>;
}

export interface SurnameMapLabel {
  countryId: string;
  countryName: string;
  record: SurnameRecord;
}

export function getSurnameCoverageStatus(
  country: Pick<SurnameCountry, 'records'> | undefined,
): SurnameCountry['coverageStatus'] {
  if (!country?.records.length) return 'no-source';
  return country.records.some((record) => record.rank === 1)
    ? 'rank-one'
    : country.records.every(
          (record) => record.observationKind === 'manual-observation',
        )
      ? 'manual-observation'
      : 'source-listed';
}

/** Only an explicit numeric rank can support the map's "most common" claim. */
export function getRankOneSurnameRecord(
  country: SurnameCountry | undefined,
): SurnameRecord | null {
  return getRankOneSurnameRecords(country)[0] ?? null;
}

/** Keeps tied or independently sourced rank-one records available to the UI. */
export function getRankOneSurnameRecords(
  country: SurnameCountry | undefined,
): readonly SurnameRecord[] {
  return country?.records.filter((record) => record.rank === 1) ?? [];
}

/** Returns the strongest source-backed map observation, including an explicitly unranked list. */
export function getDisplaySurnameRecord(
  country: SurnameCountry | undefined,
): SurnameRecord | null {
  return getRankOneSurnameRecord(country) ?? country?.records[0] ?? null;
}

let datasetPromise: Promise<SurnameDataset> | undefined;

export function decodeSurnameDataset(input: unknown): SurnameDataset {
  const parsed = surnameDatasetSchema.parse(input);
  const countries = Object.entries(parsed.countries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([countryId, country]) => ({
      countryId,
      countryIso2: country.countryIso2,
      sourceUrls: country.sourceUrls,
      records: country.records,
      coverageStatus: getSurnameCoverageStatus(country),
    }));
  return {
    sourceSnapshot: parsed.sourceSnapshot,
    sourceKind: parsed.sourceKind,
    sourceUrl: parsed.sourceUrl,
    license: parsed.license,
    coverageNote: parsed.coverageNote,
    countries,
    countriesById: new Map(
      countries.map((country) => [country.countryId, country]),
    ),
  };
}

export function loadSurnameDataset(): Promise<SurnameDataset> {
  datasetPromise ??= import('../../data/generated/surnames-by-country.json')
    .then((module) => decodeSurnameDataset(module.default))
    .catch((error: unknown) => {
      datasetPromise = undefined;
      throw error;
    });
  return datasetPromise;
}

export function resetSurnameDataset(): void {
  datasetPromise = undefined;
}
