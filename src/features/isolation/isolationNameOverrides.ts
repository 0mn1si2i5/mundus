/** Reviewed GHSL-to-GeoNames Chinese-name corrections, keyed by GHSL id. */
export interface IsolationNameOverride {
  /** Optional corrected English spelling used when reviewing a GHSL row. */
  nameEn?: string;
  nameZh: string | null;
}

export const ISOLATION_NAME_OVERRIDES: Readonly<
  Record<string, IsolationNameOverride>
> = {
  // GHSL names which are ambiguous, administrative labels, or absent from
  // GeoNames. These are reviewed explicitly rather than proximity matched.
  '10125': { nameEn: 'Shizhong District, Zaozhuang', nameZh: '枣庄市中区' },
  '673': { nameEn: 'Coyah', nameZh: '科亚' },
  '4952': { nameEn: 'Kasaï-Oriental', nameZh: '东开赛省' },
  '10695': { nameEn: 'Xiuying District, Haikou', nameZh: '海口秀英区' },
  // Same Chinese exonym is used by multiple GHSL names. Keep these rows
  // explicit and nameless until the owner selects reviewed disambiguations.
  '2471': { nameEn: 'San Diego', nameZh: null },
  '798': { nameEn: 'Santiago de los Caballeros', nameZh: null },
  '258': { nameEn: 'Tripoli', nameZh: null },
  '870': { nameEn: 'Tripoli', nameZh: null },
  '3109': { nameEn: 'Valencia', nameZh: null },
  '4522': { nameEn: 'Valencia', nameZh: null },
  '5678': { nameEn: 'Hyderabad', nameZh: null },
  '9524': { nameEn: 'Hyderabad', nameZh: null },
  '7365': { nameEn: 'São Luís', nameZh: null },
  '2018': { nameEn: 'San Luis', nameZh: null },
  '9800': { nameEn: 'Salem', nameZh: null },
  '4909': { nameEn: 'Salem', nameZh: null },
  '10309': { nameEn: 'Xiangtan', nameZh: null },
  '10289': { nameEn: 'Xiangtan', nameZh: null },
};
