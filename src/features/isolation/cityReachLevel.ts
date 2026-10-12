/** Hours of size advantage per tenfold increase in city population. */
export const CITY_REACH_LEVELS = [0.25, 0.5, 1, 2, 4, 8, 16] as const;
export type CityReachLevel = (typeof CITY_REACH_LEVELS)[number];
export const CITY_REACH_DEFAULT: CityReachLevel = 4;

export function isCityReachLevel(value: number): value is CityReachLevel {
  return (CITY_REACH_LEVELS as readonly number[]).includes(value);
}

/** URL values use a whitelist, never rounding or clamping to another level. */
export function parseCityReachParam(value: string | null): CityReachLevel {
  if (value === null || value.trim() === '') return CITY_REACH_DEFAULT;
  const number = Number(value);
  return isCityReachLevel(number) ? number : CITY_REACH_DEFAULT;
}
