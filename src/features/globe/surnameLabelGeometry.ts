import { Quaternion, Vector3 } from 'three';

export const SURNAME_LABEL_BASE_RADIUS = 1.012;
export const SURNAME_LABEL_MIN_CORNER_RADIUS = 1.006;

/**
 * Moves a billboard just far enough out that every camera-facing corner stays
 * outside the globe surface. The radial solve is cheaper and less visually
 * detached than using a worst-case radius for every camera orientation.
 */
export function getSafeSurnameLabelRadius(
  direction: Vector3,
  width: number,
  heightRatio: number,
  cameraRight: Vector3,
  cameraUp: Vector3,
): number {
  const halfWidth = width / 2;
  const halfHeight = (width * heightRatio) / 2;
  const offsetSquared = halfWidth ** 2 + halfHeight ** 2;
  const rightProjection = direction.dot(cameraRight);
  const upProjection = direction.dot(cameraUp);
  let radius = SURNAME_LABEL_BASE_RADIUS;

  for (const horizontal of [-1, 1]) {
    for (const vertical of [-1, 1]) {
      const radialProjection =
        halfWidth * horizontal * rightProjection +
        halfHeight * vertical * upProjection;
      const discriminant =
        radialProjection ** 2 +
        SURNAME_LABEL_MIN_CORNER_RADIUS ** 2 -
        offsetSquared;
      if (discriminant >= 0) {
        radius = Math.max(radius, -radialProjection + Math.sqrt(discriminant));
      }
    }
  }
  return radius;
}

/**
 * Solves label clearance when the globe is rendered inside a rotated group.
 *
 * Label anchors are stored in globe-local coordinates while the billboard
 * axes come from the camera and therefore live in world coordinates. The
 * radial solve must use the anchor direction after the group's world
 * rotation; otherwise a rotated globe can place a corner inside the surface.
 * The returned radius is still a scalar that can be applied to the original
 * local direction before positioning the child sprite.
 */
export function getSafeSurnameLabelRadiusForGroup(
  localDirection: Vector3,
  width: number,
  heightRatio: number,
  cameraRightWorld: Vector3,
  cameraUpWorld: Vector3,
  groupWorldQuaternion: Quaternion,
): number {
  const worldDirection = localDirection
    .clone()
    .normalize()
    .applyQuaternion(groupWorldQuaternion)
    .normalize();
  return getSafeSurnameLabelRadius(
    worldDirection,
    width,
    heightRatio,
    cameraRightWorld,
    cameraUpWorld,
  );
}
