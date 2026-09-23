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
  const visible: Array<{ x: number; y: number }> = [];
  const addPoint = (point: SurnameSurfaceProjectionPoint) => {
    if (point.visibility >= 0) visible.push({ x: point.x, y: point.y });
  };
  const addEdgeIntersection = (
    first: SurnameSurfaceProjectionPoint,
    second: SurnameSurfaceProjectionPoint,
  ) => {
    if (first.visibility >= 0 === second.visibility >= 0) return;
    const denominator = first.visibility - second.visibility;
    if (Math.abs(denominator) < 1e-12) return;
    const t = first.visibility / denominator;
    visible.push({
      x: first.x + (second.x - first.x) * t,
      y: first.y + (second.y - first.y) * t,
    });
  };

  for (const triangle of triangles) {
    const first = points[triangle.a];
    const second = points[triangle.b];
    const third = points[triangle.c];
    if (!first || !second || !third) continue;
    if (first.visibility < 0 && second.visibility < 0 && third.visibility < 0)
      continue;
    addPoint(first);
    addPoint(second);
    addPoint(third);
    addEdgeIntersection(first, second);
    addEdgeIntersection(second, third);
    addEdgeIntersection(third, first);
  }

  if (visible.length === 0) return null;
  return {
    left: Math.min(...visible.map((point) => point.x)),
    right: Math.max(...visible.map((point) => point.x)),
    top: Math.min(...visible.map((point) => point.y)),
    bottom: Math.max(...visible.map((point) => point.y)),
    frontPointCount: points.filter((point) => point.visibility >= 0).length,
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
  },
): SurnameLabelLayout {
  const ordered = [...rectangles].sort(
    (a, b) =>
      Number(b.selected) - Number(a.selected) ||
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
    const reason = hiddenReason(rectangle, accepted, obstacles, viewport);
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
