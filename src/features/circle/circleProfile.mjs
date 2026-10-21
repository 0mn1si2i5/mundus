// Shared by the offline build and the browser so the published smallest
// circle and every runtime result come from the same arithmetic.

export const EARTH_RADIUS_KM = 6371.0088;
/** Distance bins are one kilometre wide, out to half the circumference. */
export const PROFILE_BIN_COUNT = Math.ceil(Math.PI * EARTH_RADIUS_KM);

const DEG = Math.PI / 180;

/**
 * Turn an equirectangular count grid (row 0 at the north edge, column 0 at
 * 180°W) into a compact list of populated cell centres as unit vectors.
 */
export function prepareCells(values, width, height, unit = 1) {
  if (values.length !== width * height)
    throw new RangeError('Population grid size does not match its dimensions');
  let count = 0;
  for (let i = 0; i < values.length; i += 1) if (values[i] > 0) count += 1;
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const z = new Float64Array(count);
  const population = new Float64Array(count);
  const cellLongitude = 360 / width;
  const cellLatitude = 180 / height;
  let total = 0;
  let cursor = 0;
  for (let row = 0; row < height; row += 1) {
    const latitude = (90 - (row + 0.5) * cellLatitude) * DEG;
    const cosLatitude = Math.cos(latitude);
    const sinLatitude = Math.sin(latitude);
    for (let column = 0; column < width; column += 1) {
      const value = values[row * width + column];
      if (!(value > 0)) continue;
      const longitude = (-180 + (column + 0.5) * cellLongitude) * DEG;
      x[cursor] = cosLatitude * Math.sin(longitude);
      y[cursor] = sinLatitude;
      z[cursor] = cosLatitude * Math.cos(longitude);
      population[cursor] = value * unit;
      total += value * unit;
      cursor += 1;
    }
  }
  return { count, x, y, z, population, total };
}

/**
 * Population histogram by great-circle distance from a centre, in whole
 * kilometres. Uses the chord formula, which stays exact near the centre.
 */
export function populationProfile(cells, latitude, longitude) {
  const histogram = new Float64Array(PROFILE_BIN_COUNT + 1);
  const lat = latitude * DEG;
  const lon = longitude * DEG;
  const cx = Math.cos(lat) * Math.sin(lon);
  const cy = Math.sin(lat);
  const cz = Math.cos(lat) * Math.cos(lon);
  const { count, x, y, z, population } = cells;
  for (let i = 0; i < count; i += 1) {
    const dx = x[i] - cx;
    const dy = y[i] - cy;
    const dz = z[i] - cz;
    const half = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
    const distance = 2 * Math.asin(half) * EARTH_RADIUS_KM;
    const bin = Math.min(PROFILE_BIN_COUNT, Math.floor(distance));
    histogram[bin] += population[i];
  }
  return { histogram, total: cells.total };
}

/** Population within `radiusKm`, interpolated linearly inside one bin. */
export function populationWithin(profile, radiusKm) {
  const { histogram } = profile;
  if (!(radiusKm > 0)) return 0;
  const limit = Math.min(radiusKm, PROFILE_BIN_COUNT + 1);
  const whole = Math.floor(limit);
  let sum = 0;
  for (let bin = 0; bin < whole && bin < histogram.length; bin += 1)
    sum += histogram[bin];
  if (whole < histogram.length) sum += histogram[whole] * (limit - whole);
  return Math.min(sum, profile.total);
}

/** Smallest radius whose circle holds at least `target` people. */
export function radiusForPopulation(profile, target) {
  const { histogram } = profile;
  if (!(target > 0)) return 0;
  let sum = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    const next = sum + histogram[bin];
    if (next >= target && histogram[bin] > 0)
      return bin + (target - sum) / histogram[bin];
    sum = next;
  }
  return PROFILE_BIN_COUNT;
}

export function radiusForShare(profile, share) {
  return radiusForPopulation(profile, profile.total * share);
}
