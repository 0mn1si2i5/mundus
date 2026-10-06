import type { SurnameMapLabel } from '../surnames/surnameData';
import type { SurnameWordmark } from '../surnames/surnameWordmark';
import type { CountryLabelAnchor } from './countryLabel';
import type { GeoPoint } from './geo';
import type { SurnameLabelSlot } from './surnameLabelSlots';

export interface SurnameLabelEntry {
  label: SurnameMapLabel;
  anchor: CountryLabelAnchor;
  slot: SurnameLabelSlot;
  wordmark: SurnameWordmark;
}

/** Layout facts the viewport publishes as browser-test evidence. */
export interface SurnameLabelLayoutEvidence {
  visibleCount: number;
  collisionCount: number;
  selectedHiddenReason: SurnameLabelHiddenReason | null;
  minimumCornerRadius: number;
  visibleRectangles: string;
}

// Retry by moving the camera south when a desktop shell obstacle blocks the
// selected label. Mobile shell panels cover the compact canvas by design.
export const SURNAME_FOCUS_RETRY_OFFSETS = [-8, -16, -24, -32] as const;

export function getSurnameCameraFocusPoint(
  point: GeoPoint,
  retryOffset = 0,
): GeoPoint {
  return {
    latitude: Math.max(-75, Math.min(75, point.latitude + retryOffset)),
    longitude: point.longitude,
  };
}

export interface SurnameLabelScreenRect {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  frontFacing: boolean;
  selected: boolean;
  countryArea?: number;
  centerDistance?: number;
}

export interface SurnameLabelObstacle {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface SurnameSurfaceProjectionPoint {
  x: number;
  y: number;
  /** Positive values are on the camera-facing half of the globe. */
  visibility: number;
}

export interface SurnameSurfaceTriangle {
  a: number;
  b: number;
  c: number;
}

export interface SurnameSurfaceBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  frontPointCount: number;
}

/**
 * Projects only the camera-facing part of a curved wordmark. A triangle that
 * crosses the horizon contributes its horizon intersections, so the screen
 * envelope remains tight while the label is partly hidden by the globe.
 */
export function computeVisibleSurnameSurfaceBounds(
  points: readonly SurnameSurfaceProjectionPoint[],
  triangles: readonly SurnameSurfaceTriangle[],
): SurnameSurfaceBounds | null {
  // Keep this hot path allocation-free. The previous implementation appended
  // every triangle corner and horizon intersection to an array, then mapped
  // that array four more times for min/max. A 24x6 label grid multiplied this
  // into tens of thousands of short-lived objects per layout frame.
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let visiblePointCount = 0;
  let frontPointCount = 0;
  const include = (x: number, y: number) => {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    visiblePointCount += 1;
  };
  const includeEdgeIntersection = (
    edgeFirst: SurnameSurfaceProjectionPoint,
    edgeSecond: SurnameSurfaceProjectionPoint,
  ) => {
    if (edgeFirst.visibility >= 0 === edgeSecond.visibility >= 0) return;
    const denominator = edgeFirst.visibility - edgeSecond.visibility;
    if (Math.abs(denominator) < 1e-12) return;
    const t = edgeFirst.visibility / denominator;
    include(
      edgeFirst.x + (edgeSecond.x - edgeFirst.x) * t,
      edgeFirst.y + (edgeSecond.y - edgeFirst.y) * t,
    );
  };
  for (const point of points) {
    if (point.visibility >= 0) frontPointCount += 1;
  }
  for (const triangle of triangles) {
    const first = points[triangle.a];
    const second = points[triangle.b];
    const third = points[triangle.c];
    if (!first || !second || !third) continue;
    if (first.visibility < 0 && second.visibility < 0 && third.visibility < 0)
      continue;
    if (first.visibility >= 0) include(first.x, first.y);
    if (second.visibility >= 0) include(second.x, second.y);
    if (third.visibility >= 0) include(third.x, third.y);
    includeEdgeIntersection(first, second);
    includeEdgeIntersection(second, third);
    includeEdgeIntersection(third, first);
  }

  if (visiblePointCount === 0) return null;
  return {
    left,
    right,
    top,
    bottom,
    frontPointCount,
  };
}

export type SurnameLabelHiddenReason =
  'backface' | 'outside-viewport' | 'obstacle' | 'collision' | 'invalid';

export interface SurnameLabelLayout {
  visibleIds: ReadonlySet<string>;
  hiddenReasons: ReadonlyMap<string, SurnameLabelHiddenReason>;
  visibleCount: number;
  collisionCount: number;
  selectedVisible: boolean;
}

const OBSTACLE_PADDING_PX = 3;

/**
 * Resolves billboard rectangles in stable priority order. The selected
 * country's label is considered first; larger readable labels then get
 * preference so the atlas keeps the strongest country wordmarks visible.
 */
export function computeSurnameLabelLayout(
  rectangles: readonly SurnameLabelScreenRect[],
  obstacles: readonly SurnameLabelObstacle[],
  viewport: {
    width: number;
    height: number;
    /** Maximum number of labels to submit to the transparent render pass. */
    maxVisibleCount?: number;
    /** Labels already rendered in the previous stable layout pass. */
    preferredIds?: ReadonlySet<string>;
    /** Keep front-facing labels even when their screen rectangles overlap. */
    allowCollisions?: boolean;
  },
): SurnameLabelLayout {
  const preferredIds = viewport.preferredIds;
  const ordered = [...rectangles].sort(
    (a, b) =>
      Number(b.selected) - Number(a.selected) ||
      Number(preferredIds?.has(b.id) ?? false) -
        Number(preferredIds?.has(a.id) ?? false) ||
      rectArea(b) - rectArea(a) ||
      (b.countryArea ?? 0) - (a.countryArea ?? 0) ||
      (a.centerDistance ?? 0) - (b.centerDistance ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const accepted: SurnameLabelScreenRect[] = [];
  const visibleIds = new Set<string>();
  const hiddenReasons = new Map<string, SurnameLabelHiddenReason>();
  let collisionCount = 0;

  for (const rectangle of ordered) {
    let reason = hiddenReason(rectangle, accepted, obstacles, viewport);
    if (reason === 'obstacle' && rectangle.selected) {
      // The selected country is the active result of the atlas. Keep it
      // available after a user drag when a compact shell panel crosses the
      // label; the selected-first ordering still prevents it from colliding
      // with another wordmark.
      reason = null;
    }
    if (
      !reason &&
      viewport.maxVisibleCount !== undefined &&
      accepted.length >= Math.max(1, Math.floor(viewport.maxVisibleCount))
    ) {
      // Transparent globe labels are expensive on low-power GPUs. The
      // ordering keeps the selected country and the largest readable labels
      // in the render budget while other labels become available as the globe
      // rotates and the screen layout changes.
      reason = 'collision';
    }
    if (reason === 'collision' && viewport.allowCollisions) reason = null;
    if (reason) {
      hiddenReasons.set(rectangle.id, reason);
      if (reason === 'obstacle' || reason === 'collision') {
        collisionCount += 1;
      }
      continue;
    }
    accepted.push(rectangle);
    visibleIds.add(rectangle.id);
  }

  return {
    visibleIds,
    hiddenReasons,
    visibleCount: visibleIds.size,
    collisionCount,
    selectedVisible: ordered.some(
      (rectangle) => rectangle.selected && visibleIds.has(rectangle.id),
    ),
  };
}

function hiddenReason(
  rectangle: SurnameLabelScreenRect,
  accepted: readonly SurnameLabelScreenRect[],
  obstacles: readonly SurnameLabelObstacle[],
  viewport: {
    width: number;
    height: number;
  },
): SurnameLabelHiddenReason | null {
  if (!hasFiniteRect(rectangle)) return 'invalid';
  if (!rectangle.frontFacing) return 'backface';
  const visibleArea = clippedRectArea(
    rectangle,
    viewport.width,
    viewport.height,
  );
  const totalArea = rectArea(rectangle);
  if (totalArea <= 0 || visibleArea <= 0 || visibleArea / totalArea < 0.25) {
    return 'outside-viewport';
  }
  if (
    obstacles.some((obstacle) => intersectsWithPadding(rectangle, obstacle))
  ) {
    return 'obstacle';
  }
  if (accepted.some((other) => intersects(rectangle, other))) {
    return 'collision';
  }
  return null;
}

function clippedRectArea(
  rectangle: SurnameLabelScreenRect,
  width: number,
  height: number,
): number {
  const left = Math.max(0, rectangle.left);
  const right = Math.min(width, rectangle.right);
  const top = Math.max(0, rectangle.top);
  const bottom = Math.min(height, rectangle.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function hasFiniteRect(rectangle: SurnameLabelScreenRect): boolean {
  return [
    rectangle.left,
    rectangle.right,
    rectangle.top,
    rectangle.bottom,
  ].every(Number.isFinite);
}

function rectArea(rectangle: SurnameLabelScreenRect): number {
  const width = Math.max(0, rectangle.right - rectangle.left);
  const height = Math.max(0, rectangle.bottom - rectangle.top);
  return width * height;
}

function intersects(
  first: SurnameLabelScreenRect,
  second: SurnameLabelScreenRect,
): boolean {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}

function intersectsWithPadding(
  rectangle: SurnameLabelScreenRect,
  obstacle: SurnameLabelObstacle,
): boolean {
  return (
    rectangle.left < obstacle.right + OBSTACLE_PADDING_PX &&
    rectangle.right > obstacle.left - OBSTACLE_PADDING_PX &&
    rectangle.top < obstacle.bottom + OBSTACLE_PADDING_PX &&
    rectangle.bottom > obstacle.top - OBSTACLE_PADDING_PX
  );
}
