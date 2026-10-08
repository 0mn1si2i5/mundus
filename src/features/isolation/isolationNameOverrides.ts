/** Reviewed GHSL-to-GeoNames Chinese-name corrections, keyed by GHSL id. */
export interface IsolationNameOverride {
  nameZh: string | null;
  countryZh?: string | null;
}

export const ISOLATION_NAME_OVERRIDES: Readonly<Record<string, IsolationNameOverride>> = {};
