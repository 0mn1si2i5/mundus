import { BackSide, FrontSide } from 'three';
import type { GeoPoint } from './geo';
import type { AntipodeRelationDiagnosticReason } from './AntipodeRelationLayer';

/**
 * Browser-test evidence written as `data-*` attributes on the globe viewport.
 * The scene reports measured render facts through these recorders so the
 * WebGL internals stay private while E2E tests can still assert them.
 */

export type MarkerDiagnosticReason =
  'point' | 'interaction' | 'camera-focus' | 'resize';

export type SunlineDiagnosticReason =
  'mount' | 'position' | 'resize' | 'interaction' | 'camera-focus';

export interface ProjectedMarkerEvidence {
  x: number;
  y: number;
  frontFacing: boolean;
}

export interface AntipodeMaterialEvidence {
  side: number;
  depthWrite: boolean;
  renderOrder: number;
  radius: number;
}

export type CityMarkerRole = 'origin-city' | 'antipode-city';

export function formatDiagnosticCoordinate(coordinate: number) {
  return Number(coordinate.toFixed(6)).toString();
}

function formatDiagnosticPoint(point: GeoPoint) {
  return `${formatDiagnosticCoordinate(point.latitude)},${formatDiagnosticCoordinate(point.longitude)}`;
}

export function materialDiagnostic(material: {
  depthTest: boolean;
  depthWrite: boolean;
  renderOrder: number;
}) {
  return `depthTest:${material.depthTest},depthWrite:${material.depthWrite},renderOrder:${material.renderOrder}`;
}

function materialEvidenceDiagnostic(material: AntipodeMaterialEvidence) {
  const side =
    material.side === FrontSide
      ? 'FrontSide'
      : material.side === BackSide
        ? 'BackSide'
        : String(material.side);
  return `side:${side},depthWrite:${material.depthWrite},renderOrder:${material.renderOrder},radius:${material.radius}`;
}

function incrementRevision(value: string | undefined) {
  return String(Number(value ?? 0) + 1);
}

export function clearCameraDiagnostic(element: HTMLElement | null) {
  if (!element) return;
  delete element.dataset.cameraFocusTarget;
  delete element.dataset.cameraCenterLatitude;
  delete element.dataset.cameraCenterLongitude;
  delete element.dataset.cameraFocusMotion;
  delete element.dataset.cameraFocusStartedAt;
  delete element.dataset.cameraFocusElapsedMs;
  delete element.dataset.cameraFocusCompletedRevision;
  element.dataset.cameraFocusState = 'idle';
}

/** Clears per-point evidence after a mode or selected-point change. */
export function resetViewportDiagnostics(
  element: HTMLElement | null,
  showAntipodes: boolean,
) {
  clearCameraDiagnostic(element);
  if (!element) return;
  delete element.dataset.cameraDistance;
  delete element.dataset.markerOriginActualCssDiameter;
  delete element.dataset.markerOriginTarget;
  delete element.dataset.markerDiagnosticRevision;
  delete element.dataset.markerDiagnosticReason;
  delete element.dataset.antipodeRelationFocusEvidence;
  if (showAntipodes) {
    element.dataset.markerDiagnosticState = 'idle-rotation';
  } else {
    delete element.dataset.markerDiagnosticState;
    delete element.dataset.antipodeOuterMaterial;
    delete element.dataset.antipodeInnerMaterial;
    delete element.dataset.antipodeHitSphere;
    delete element.dataset.antipodeHitSpherePickRevision;
  }
}

export function createViewportDiagnostics() {
  let target: HTMLElement | null = null;
  let antipodesVisible = false;
  const getElement = () => target;
  // Antipode-only evidence is ignored outside Other Side so stale scene
  // callbacks cannot leak attributes into another mode.
  const antipodeElement = () => (antipodesVisible ? target : null);

  return {
    /** Binds the recorders to the mounted viewport and current mode. */
    attach(element: HTMLElement | null, showAntipodes: boolean) {
      target = element;
      antipodesVisible = showAntipodes;
    },

    cameraFocusStart() {
      clearCameraDiagnostic(getElement());
    },

    cameraFocusAnimationStart(timestamp: number) {
      const element = getElement();
      clearCameraDiagnostic(element);
      if (!element) return;
      element.dataset.cameraFocusStartedAt = timestamp.toString();
      element.dataset.cameraFocusState = 'animating';
      element.dataset.cameraFocusRequestRevision = incrementRevision(
        element.dataset.cameraFocusRequestRevision,
      );
    },

    cameraFocusComplete(
      point: GeoPoint,
      motion: 'instant' | 'animated',
      elapsedMs: number,
    ) {
      const element = getElement();
      if (!element) return;
      const latitude = formatDiagnosticCoordinate(point.latitude);
      const longitude = formatDiagnosticCoordinate(point.longitude);
      element.dataset.cameraFocusTarget = `${latitude},${longitude}`;
      element.dataset.cameraCenterLatitude = latitude;
      element.dataset.cameraCenterLongitude = longitude;
      element.dataset.cameraFocusMotion = motion;
      element.dataset.cameraFocusElapsedMs = Math.round(elapsedMs).toString();
      element.dataset.cameraFocusCompletedRevision =
        element.dataset.cameraFocusRequestRevision ?? '0';
      element.dataset.cameraFocusState = 'complete';
    },

    marker(
      globeCameraDistance: number,
      actualCssDiameter: number,
      latitude: number,
      longitude: number,
      reason: MarkerDiagnosticReason,
    ) {
      const element = getElement();
      if (!element) return;
      element.dataset.cameraDistance =
        formatDiagnosticCoordinate(globeCameraDistance);
      element.dataset.markerOriginActualCssDiameter =
        actualCssDiameter.toString();
      element.dataset.markerOriginTarget = formatDiagnosticPoint({
        latitude,
        longitude,
      });
      element.dataset.markerDiagnosticRevision = incrementRevision(
        element.dataset.markerDiagnosticRevision,
      );
      element.dataset.markerDiagnosticState = 'sampled';
      element.dataset.markerDiagnosticReason = reason;
    },

    sunlineProjection(
      selected: ProjectedMarkerEvidence,
      selectedSurface: ProjectedMarkerEvidence,
      solar: ProjectedMarkerEvidence,
      reason: SunlineDiagnosticReason,
    ) {
      const element = getElement();
      if (!element) return;
      element.dataset.sunlineSelectedProjectedCenter = `${selected.x},${selected.y}`;
      element.dataset.sunlineSelectedSurfaceProjectedCenter = `${selectedSurface.x},${selectedSurface.y}`;
      element.dataset.sunlineSolarProjectedCenter = `${solar.x},${solar.y}`;
      element.dataset.sunlineSelectedFrontFacing = String(selected.frontFacing);
      element.dataset.sunlineSolarFrontFacing = String(solar.frontFacing);
      element.dataset.sunlineDiagnosticRevision = incrementRevision(
        element.dataset.sunlineDiagnosticRevision,
      );
      element.dataset.sunlineDiagnosticReason = reason;
    },

    centerGlowFrame(revision: number) {
      const element = antipodeElement();
      if (!element) return;
      element.dataset.antipodeCenterGlowRevision = String(revision);
    },

    centerGlowMode(mode: 'static' | 'deterministic') {
      const element = antipodeElement();
      if (!element) return;
      element.dataset.antipodeCenterGlowFlicker = mode;
    },

    antipodeScene(
      outer: AntipodeMaterialEvidence,
      inner: AntipodeMaterialEvidence,
    ) {
      const element = antipodeElement();
      if (!element) return;
      element.dataset.antipodeOuterMaterial = materialEvidenceDiagnostic(outer);
      element.dataset.antipodeInnerMaterial = materialEvidenceDiagnostic(inner);
      element.dataset.antipodeHitSphere = 'enabled';
    },

    antipodeLayers(base: string, dragShellVisible: string, highlight: string) {
      const element = antipodeElement();
      if (!element) return;
      element.dataset.antipodeBaseSurface = base;
      element.dataset.antipodeDragShellVisible = dragShellVisible;
      element.dataset.antipodeHighlight = highlight;
    },

    hitSpherePick() {
      const element = antipodeElement();
      if (!element) return;
      element.dataset.antipodeHitSpherePickRevision = incrementRevision(
        element.dataset.antipodeHitSpherePickRevision,
      );
    },

    globePick(point: GeoPoint) {
      const element = getElement();
      if (!element) return;
      element.dataset.globeLastPickTarget = formatDiagnosticPoint(point);
      element.dataset.globePickRevision = incrementRevision(
        element.dataset.globePickRevision,
      );
    },

    antipodeRelationArcCount(count: number | null) {
      const element = getElement();
      if (!element) return;
      if (count === null) {
        delete element.dataset.antipodeRelationDiagnosticSource;
        delete element.dataset.antipodeRelationArcCount;
        return;
      }
      element.dataset.antipodeRelationDiagnosticSource = 'measured';
      element.dataset.antipodeRelationArcCount = String(count);
    },

    antipodeRelationFocusEvidence(evidence: string) {
      const element = antipodeElement();
      if (!element) return;
      if (evidence.startsWith('arcPoints:')) {
        const markerEvidence = element.dataset.antipodeRelationFocusEvidence;
        element.dataset.antipodeRelationFocusEvidence = markerEvidence
          ? `${markerEvidence},${evidence}`
          : evidence;
      } else {
        element.dataset.antipodeRelationFocusEvidence = evidence;
      }
    },

    antipodeCityMarkerSize(
      role: CityMarkerRole,
      cssPixels: number | null,
      reason?: AntipodeRelationDiagnosticReason,
    ) {
      const element = getElement();
      if (!element) return;
      const key =
        role === 'origin-city'
          ? 'markerOriginCityActualCssDiameter'
          : 'markerAntipodeCityActualCssDiameter';
      if (cssPixels === null) {
        delete element.dataset[key];
        if (
          !element.dataset.markerOriginCityActualCssDiameter &&
          !element.dataset.markerAntipodeCityActualCssDiameter
        ) {
          delete element.dataset.antipodeRelationDiagnosticRevision;
          delete element.dataset.antipodeRelationDiagnosticReason;
        }
        return;
      }
      element.dataset[key] = Number(cssPixels.toFixed(3)).toString();
      element.dataset.antipodeRelationDiagnosticRevision = incrementRevision(
        element.dataset.antipodeRelationDiagnosticRevision,
      );
      if (reason) element.dataset.antipodeRelationDiagnosticReason = reason;
    },
  };
}

export type ViewportDiagnostics = ReturnType<typeof createViewportDiagnostics>;
