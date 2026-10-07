import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  getSafeSurnameLabelRadius,
  getSafeSurnameLabelRadiusForGroup,
  SURNAME_LABEL_MIN_CORNER_RADIUS,
} from './surnameLabelGeometry';
import { SURNAME_WORDMARK_HEIGHT_RATIO } from '../surnames/surnameWordmark';

describe('surname label 3D clearance', () => {
  it('keeps every billboard corner outside the globe surface', () => {
    const direction = new Vector3(0.38, 0.52, 0.765).normalize();
    const right = new Vector3(1, 0, 0);
    const up = new Vector3(0, 1, 0);
    const width = 0.34;
    const heightRatio = 0.34;
    const radius = getSafeSurnameLabelRadius(
      direction,
      width,
      heightRatio,
      right,
      up,
    );
    const corners = [-1, 1].flatMap((horizontal) =>
      [-1, 1].map((vertical) =>
        direction
          .clone()
          .multiplyScalar(radius)
          .addScaledVector(right, (width / 2) * horizontal)
          .addScaledVector(up, ((width * heightRatio) / 2) * vertical),
      ),
    );

    expect(radius).toBeGreaterThanOrEqual(1.012);
    expect(
      Math.min(...corners.map((corner) => corner.length())),
    ).toBeGreaterThanOrEqual(SURNAME_LABEL_MIN_CORNER_RADIUS - 1e-9);
  });

  it('uses the SVG wordmark aspect ratio for the surface plane', () => {
    expect(SURNAME_WORDMARK_HEIGHT_RATIO).toBeCloseTo(280 / 1024, 12);
  });

  it('does not inflate small labels beyond the base shell unnecessarily', () => {
    const direction = new Vector3(0, 0, 1);
    const radius = getSafeSurnameLabelRadius(
      direction,
      0.01,
      0.34,
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
    );
    expect(radius).toBe(1.012);
  });

  it.each([Math.PI / 2, -Math.PI / 2])(
    'keeps corners safe when the globe group is rotated around Y (%s radians)',
    (angle) => {
      const localDirection = new Vector3(0, 0, 1);
      const groupRotation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        angle,
      );
      const cameraRightWorld = new Vector3(1, 0, 0);
      const cameraUpWorld = new Vector3(0, 1, 0);
      const width = 0.34;
      const heightRatio = 0.34;
      const radius = getSafeSurnameLabelRadiusForGroup(
        localDirection,
        width,
        heightRatio,
        cameraRightWorld,
        cameraUpWorld,
        groupRotation,
      );
      const worldDirection = localDirection
        .clone()
        .applyQuaternion(groupRotation)
        .normalize();
      const corners = [-1, 1].flatMap((horizontal) =>
        [-1, 1].map((vertical) =>
          worldDirection
            .clone()
            .multiplyScalar(radius)
            .addScaledVector(cameraRightWorld, (width / 2) * horizontal)
            .addScaledVector(
              cameraUpWorld,
              ((width * heightRatio) / 2) * vertical,
            ),
        ),
      );

      // Passing the unrotated local direction to the old solver is the bug
      // this test guards against: its base radius is visibly unsafe here.
      const mixedSpaceRadius = getSafeSurnameLabelRadius(
        localDirection,
        width,
        heightRatio,
        cameraRightWorld,
        cameraUpWorld,
      );
      const mixedSpaceCorners = [-1, 1].flatMap((horizontal) =>
        [-1, 1].map((vertical) =>
          worldDirection
            .clone()
            .multiplyScalar(mixedSpaceRadius)
            .addScaledVector(cameraRightWorld, (width / 2) * horizontal)
            .addScaledVector(
              cameraUpWorld,
              ((width * heightRatio) / 2) * vertical,
            ),
        ),
      );

      expect(radius).toBeGreaterThan(SURNAME_LABEL_MIN_CORNER_RADIUS);
      expect(
        Math.min(...corners.map((corner) => corner.length())),
      ).toBeGreaterThanOrEqual(SURNAME_LABEL_MIN_CORNER_RADIUS - 1e-9);
      expect(mixedSpaceRadius).toBe(1.012);
      expect(
        Math.min(...mixedSpaceCorners.map((corner) => corner.length())),
      ).toBeLessThan(SURNAME_LABEL_MIN_CORNER_RADIUS);
    },
  );
});
