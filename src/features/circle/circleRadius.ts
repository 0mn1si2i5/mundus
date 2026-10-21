export const CIRCLE_RADIUS_MIN_KM = 50;
export const CIRCLE_RADIUS_MAX_KM = 20000;
/** Below this radius the 0.25° cells (about 28 km) make the count rough. */
export const CIRCLE_ROUGH_BELOW_KM = 200;
export const CIRCLE_SLIDER_STEPS = 1000;
export const CIRCLE_SHARE_MILESTONES = [0.1, 0.25, 0.5, 0.75, 0.9] as const;

const LOG_MIN = Math.log(CIRCLE_RADIUS_MIN_KM);
const LOG_SPAN = Math.log(CIRCLE_RADIUS_MAX_KM) - LOG_MIN;

export function isCircleRadius(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= CIRCLE_RADIUS_MIN_KM &&
    value <= CIRCLE_RADIUS_MAX_KM
  );
}

/** `radius` is a whole number of kilometres; anything else means default. */
export function parseCircleRadiusParam(raw: string | null): number | null {
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  const value = Number(raw);
  return isCircleRadius(value) ? value : null;
}

export function roundCircleRadius(km: number): number {
  const clamped = Math.min(
    CIRCLE_RADIUS_MAX_KM,
    Math.max(CIRCLE_RADIUS_MIN_KM, km),
  );
  const step = clamped < 200 ? 1 : clamped < 2000 ? 5 : 10;
  return Math.min(
    CIRCLE_RADIUS_MAX_KM,
    Math.max(CIRCLE_RADIUS_MIN_KM, Math.round(clamped / step) * step),
  );
}

export function radiusToSlider(km: number): number {
  const clamped = Math.min(
    CIRCLE_RADIUS_MAX_KM,
    Math.max(CIRCLE_RADIUS_MIN_KM, km),
  );
  return Math.round(
    ((Math.log(clamped) - LOG_MIN) / LOG_SPAN) * CIRCLE_SLIDER_STEPS,
  );
}

export function sliderToRadius(position: number): number {
  const fraction =
    Math.min(CIRCLE_SLIDER_STEPS, Math.max(0, position)) / CIRCLE_SLIDER_STEPS;
  return roundCircleRadius(Math.exp(LOG_MIN + fraction * LOG_SPAN));
}
