import type { GeoPoint } from '../globe/geo';
import type { CircleDataset } from './circleData';
import {
  populationProfile,
  populationWithin,
  radiusForShare,
} from './circleProfile.mjs';
import { CIRCLE_SHARE_MILESTONES } from './circleRadius';

export interface CircleSelection {
  /** Radius of the smallest circle here that holds half the population. */
  halfRadiusKm: number;
  /** The radius shown: the chosen radius, or the half radius by default. */
  radiusKm: number;
  population: number;
  share: number;
  milestones: readonly { share: number; radiusKm: number }[];
  /** Half radius relative to the world's smallest half circle. */
  timesSmallest: number;
}

export function computeCircleSelection(
  dataset: CircleDataset,
  point: GeoPoint,
  chosenRadiusKm: number | null,
): CircleSelection {
  const profile = populationProfile(
    dataset.cells,
    point.latitude,
    point.longitude,
  );
  const halfRadiusKm = radiusForShare(profile, 0.5);
  const radiusKm = chosenRadiusKm ?? halfRadiusKm;
  const population =
    chosenRadiusKm === null
      ? dataset.total / 2
      : populationWithin(profile, radiusKm);
  return {
    halfRadiusKm,
    radiusKm,
    population,
    share: population / dataset.total,
    milestones: CIRCLE_SHARE_MILESTONES.map((share) => ({
      share,
      radiusKm: radiusForShare(profile, share),
    })),
    timesSmallest: halfRadiusKm / dataset.smallest.radiusKm,
  };
}
