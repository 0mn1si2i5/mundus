/** Compare fresh country totals without replacing them with historical values. */
export function compareCountryTotals(key, actual, expected, countries) {
  if (
    !Array.isArray(actual) ||
    !Array.isArray(expected) ||
    actual.length !== expected.length
  )
    throw new Error(`S8: ${key}: country total array lengths differ`);
  let maximumRelativeError = 0;
  for (const country of countries) {
    const a = actual[country.paletteIndex],
      b = expected[country.paletteIndex];
    if (a === null && b === null) continue;
    const error = a === b ? 0 : Math.abs(a - b) / Math.abs(b);
    if (
      a === null ||
      b === null ||
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      !(error < 1e-9)
    )
      throw new Error(
        `S8: ${key} ${country.id}: fresh=${a}, prior=${b}, relativeError=${error}`,
      );
    maximumRelativeError = Math.max(maximumRelativeError, error);
  }
  return { countriesCompared: countries.length, maximumRelativeError };
}
