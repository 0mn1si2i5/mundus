import type { ReachSummary, RouteResult } from './landBorders';

/**
 * Crossing bands from the start, lowest crossings first; viridis steps keep
 * them apart from the ocean, the base land and the selection colour.
 */
export const CROSSING_BANDS = [
  { min: 1, max: 1, color: '#46327e' },
  { min: 2, max: 2, color: '#365c8d' },
  { min: 3, max: 4, color: '#277f8e' },
  { min: 5, max: 6, color: '#1fa187' },
  { min: 7, max: 9, color: '#4ac16d' },
  { min: 10, max: Infinity, color: '#a0da39' },
] as const;

export const ROUTE_COLORS = {
  through: '#365c8d',
  destination: '#1fa187',
} as const;

export function crossingColor(crossings: number): string {
  // The last band has no upper bound.
  return CROSSING_BANDS.find((band) => crossings <= band.max)!.color;
}

/**
 * Globe colours for each unit: crossing bands from the start, or only the
 * route when a destination is set. The start keeps the selection colour and
 * unreachable land keeps the base land colour.
 */
export function bordersCountryColors(
  reach: ReachSummary | null,
  route: RouteResult | null,
): ReadonlyMap<string, string> {
  const colors = new Map<string, string>();
  if (route?.status === 'route') {
    const steps = route.steps;
    steps.forEach((step, index) => {
      if (index === 0) return;
      colors.set(
        step.countryId,
        index === steps.length - 1
          ? ROUTE_COLORS.destination
          : ROUTE_COLORS.through,
      );
    });
    return colors;
  }
  if (route) return colors;
  for (const [countryId, crossings] of reach?.crossings ?? []) {
    colors.set(countryId, crossingColor(crossings));
  }
  return colors;
}
