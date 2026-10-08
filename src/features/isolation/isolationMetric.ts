export const EARTH_RADIUS_KM = 6371.0088;
export const ALPHA_MIN = 0.1;
export const ALPHA_MAX = 1;
export const ALPHA_DEFAULT = 0.5;

export interface MetricPoint {
  latitude: number;
  longitude: number;
}

export interface MetricCity extends MetricPoint {
  id: string;
  population: number;
}

export interface RecordHolder {
  index: number;
  distanceKm: number;
}

export interface RankingEntry {
  index: number;
  distanceKm: number;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Great-circle distance between two WGS84 latitude/longitude points. */
export function haversineKm(a: MetricPoint, b: MetricPoint): number {
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const latitudeDelta = latitudeB - latitudeA;
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;

  // Rounding at antipodal points can put the radicand a few ulps above one.
  return (
    2 *
    EARTH_RADIUS_KM *
    Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))))
  );
}

/**
 * Build the increasing-distance population record for one focal city.
 *
 * The input is left untouched.  Distance ties are resolved before records are
 * collected, so a record holder is deterministic even when two city centres
 * coincide.
 */
export function recordHolders(
  focalIndex: number,
  cities: readonly MetricCity[],
): RecordHolder[] {
  const focal = cities[focalIndex];
  if (!focal) {
    return [];
  }

  const candidates = cities
    .map((city, index) => ({
      city,
      index,
      distanceKm: haversineKm(focal, city),
    }))
    .filter((candidate) => candidate.index !== focalIndex)
    .sort((left, right) => {
      const distanceOrder = left.distanceKm - right.distanceKm;
      if (distanceOrder !== 0) {
        return distanceOrder;
      }
      const populationOrder = right.city.population - left.city.population;
      if (populationOrder !== 0) {
        return populationOrder;
      }
      const idOrder = compareIds(left.city.id, right.city.id);
      return idOrder !== 0 ? idOrder : left.index - right.index;
    });

  const minimumPopulation = ALPHA_MIN * focal.population;
  let largestPopulationSeen = Number.NEGATIVE_INFINITY;
  const holders: RecordHolder[] = [];

  for (const candidate of candidates) {
    if (candidate.city.population <= largestPopulationSeen) {
      continue;
    }
    largestPopulationSeen = candidate.city.population;

    if (candidate.city.population >= minimumPopulation) {
      holders.push({
        index: candidate.index,
        distanceKm: candidate.distanceKm,
      });
    }

    // The first record at least as large as the focal city covers alpha = 1.
    if (candidate.city.population >= focal.population) {
      break;
    }
  }

  return holders;
}

/** Look up the first record holder meeting the inclusive population threshold. */
export function competitorAt(
  holders: readonly RecordHolder[],
  populations: readonly number[],
  focalPopulation: number,
  alpha: number,
): RecordHolder | null {
  const threshold = alpha * focalPopulation;
  for (const holder of holders) {
    const population = populations[holder.index];
    if (population !== undefined && population >= threshold) {
      return holder;
    }
  }
  return null;
}

/**
 * Rank focal cities by their current hierarchical isolation radius.
 *
 * `holdersByCity` is indexed by city index and contains null for non-focal
 * cities.  Keeping this aligned with the dataset's city array avoids making
 * callers maintain a second index map while the result list is displayed.
 */
export function rankingAt(
  focalIndices: readonly number[],
  cities: readonly MetricCity[],
  holdersByCity: readonly (readonly RecordHolder[] | null)[],
  alpha: number,
): RankingEntry[] {
  const ranked: RankingEntry[] = [];
  const populations = cities.map((city) => city.population);

  for (const index of focalIndices) {
    const focal = cities[index];
    const holders = holdersByCity[index];
    if (!focal || !holders) {
      continue;
    }
    const competitor = competitorAt(
      holders,
      populations,
      focal.population,
      alpha,
    );
    if (competitor) {
      ranked.push({ index, distanceKm: competitor.distanceKm });
    }
  }

  ranked.sort((left, right) => {
    const distanceOrder = right.distanceKm - left.distanceKm;
    if (distanceOrder !== 0) {
      return distanceOrder;
    }
    const leftCity = cities[left.index];
    const rightCity = cities[right.index];
    if (!leftCity || !rightCity) {
      return left.index - right.index;
    }
    const populationOrder = rightCity.population - leftCity.population;
    if (populationOrder !== 0) {
      return populationOrder;
    }
    const idOrder = compareIds(leftCity.id, rightCity.id);
    return idOrder !== 0 ? idOrder : left.index - right.index;
  });

  return ranked;
}

/** Round a slider/store value to the UI step and keep it within its domain. */
export function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return ALPHA_DEFAULT;
  }
  const rounded = Math.round(value * 100) / 100;
  return Math.max(ALPHA_MIN, Math.min(ALPHA_MAX, rounded));
}

/** Parse the URL value; malformed and out-of-range values use the default. */
export function parseAlphaParam(raw: string | null): number {
  if (raw === null || raw.trim() === '') {
    return ALPHA_DEFAULT;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < ALPHA_MIN || value > ALPHA_MAX) {
    return ALPHA_DEFAULT;
  }
  return Math.round(value * 100) / 100;
}
