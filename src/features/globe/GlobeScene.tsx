import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import {
  useEffect,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type Ref,
} from 'react';
import type {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import { Quaternion, Vector3 } from 'three';
import { useAppStore } from '../../state/appStore';
import {
  createCountryHighlightTexture,
  createCountryTexture,
  getCountryDataset,
  type CountryFeature,
} from './countryData';
import {
  antipodeOf,
  createAntipodeCrossSection,
  createGraticuleLines,
  geoToVector3,
  vector3ToGeo,
} from './geo';
import {
  isSelectionGesture,
  rotateCameraVertically,
  TOUCH_CLICK_DRAG_THRESHOLD_PX,
} from './interaction';
import { type QualityProfile } from './quality';
import {
  ANTIPODE_DRAG_RENDERING,
  GLOBE_COLOR_CONTRACT,
  GLOBE_RENDERING,
  SUNLINE_RENDERING,
} from './rendering';
import type { GeoPoint } from './geo';
import type { AntipodeRelation } from '../antipodes/relation';
import {
  AntipodeRelationLayer,
  type AntipodeRelationDiagnosticHandle,
} from './AntipodeRelationLayer';
import { VectorGlobeLayer, type VectorGlobeState } from './VectorGlobeLayer';
import type { VectorGlobeResources } from './vectorGlobe';
import {
  getCountryLabelAnchor,
  getCountryLabelAnchorForId,
} from './countryLabel';
import { type SurnameLabelHiddenReason } from './surnameLabelLayout';
import type { SurnameMapLabel } from '../surnames/surnameData';
import { resolveSurnameWordmark } from '../surnames/surnameWordmark';
import type { SurnameDisplayMode } from '../../state/urlState';
import type { SurnameLabelSlot } from './surnameLabelSlots';
import {
  CAMERA_FOCUS_DURATION_MS,
  cameraFocusAnimationProgress,
  clampGlobeCameraDistance,
  GLOBE_CAMERA_DISTANCE,
} from './camera';
import { ignoreRaycast } from './sceneUtils';
import { useReducedMotion } from './useReducedMotion';
import { useSurnameAtlasRuntime } from './useSurnameAtlasRuntime';
import { Marker, type MarkerDiagnosticHandle } from './Marker';
import {
  SunlineLayer,
  SunlineProjectionDiagnostic,
  type SunlineDiagnosticHandle,
} from './SunlineLayer';
import { AntipodeCrossSection, CenterCandleGlow } from './AntipodeCrossSection';
import {
  formatDiagnosticCoordinate,
  type ViewportDiagnostics,
} from './viewportDiagnostics';
import {
  getSurnameCameraFocusPoint,
  SURNAME_FOCUS_RETRY_OFFSETS,
} from './surnameLabelLayout';
import { SurnameMapLabelLayer } from './SurnameMapLabelLayer';

export interface GlobeKeyboardController {
  rotateHorizontal: (radians: number) => void;
  rotateVertical: (radians: number) => void;
  zoom: (factor: number) => void;
  selectCenter: () => void;
  cancelCameraGesture: () => void;
}

interface OrbitControlsHandle {
  update: () => void;
  enabled: boolean;
}

const NO_COUNTRIES: readonly CountryFeature[] = [];

export interface SunlineRenderState {
  subsolarPoint: GeoPoint;
}

interface GlobeSceneProps {
  profile: QualityProfile;
  benchmarkActive: boolean;
  recordBenchmarkFrame: (timestamp: number) => void;
  keyboardController: Ref<GlobeKeyboardController>;
  countryFills: ReadonlyMap<string, string> | null;
  showAntipodes: boolean;
  antipodeDragActive: boolean;
  dragDiagnosticsEnabled: boolean;
  sunline: SunlineRenderState | null;
  antipodeRelation: AntipodeRelation | null;
  surnameMapLabels: readonly SurnameMapLabel[];
  surnameDisplayMode: SurnameDisplayMode;
  cameraGestureCancelRef: MutableRefObject<(() => void) | null>;
  onSurnameLabelVisibilityChange: (visible: boolean) => void;
  onSurnameLabelLayoutChange: (layout: {
    entryCount: number;
    visibleCount: number;
    collisionCount: number;
    selectedHiddenReason: SurnameLabelHiddenReason | null;
    minimumCornerRadius: number;
    visibleRectangles: string;
  }) => void;
  diagnostics: ViewportDiagnostics;
  onVectorStateChange: (
    state: VectorGlobeState,
    resources: VectorGlobeResources | null,
  ) => void;
  onVectorPaletteUpdate: (version: number) => void;
  onVectorDragMaterialChange: (transparent: boolean) => void;
  onVectorDragEvidence: (alphaEvidence: string, orderEvidence: string) => void;
  onVectorSunlineHighlightChange: (evidence: string | null) => void;
  onVectorRenderEvidence: (vectorDraws: number, rendererCalls: number) => void;
  vectorRenderSampleKey: number;
  pointerActiveRef: MutableRefObject<boolean>;
}

export function GlobeScene({
  profile,
  benchmarkActive,
  recordBenchmarkFrame,
  keyboardController,
  countryFills,
  showAntipodes,
  antipodeDragActive,
  dragDiagnosticsEnabled,
  sunline,
  antipodeRelation,
  surnameMapLabels,
  surnameDisplayMode,
  cameraGestureCancelRef,
  onSurnameLabelVisibilityChange,
  onSurnameLabelLayoutChange,
  onVectorStateChange,
  onVectorPaletteUpdate,
  onVectorDragMaterialChange,
  onVectorDragEvidence,
  onVectorSunlineHighlightChange,
  onVectorRenderEvidence,
  vectorRenderSampleKey,
  diagnostics,
  pointerActiveRef,
}: GlobeSceneProps) {
  const {
    cameraFocusStart: onCameraFocusStart,
    userCameraMove: onUserCameraMove,
    cameraFocusAnimationStart: onCameraFocusAnimationStart,
    cameraFocusComplete: onCameraFocusComplete,
    marker: onMarkerDiagnostic,
    sunlineProjection: onSunlineProjectionDiagnostic,
    centerGlowFrame: onCenterGlowFrame,
    centerGlowMode: onCenterGlowMode,
    antipodeScene: onAntipodeSceneDiagnostic,
    antipodeLayers: onAntipodeLayerDiagnostic,
    hitSpherePick: onHitSpherePick,
    globePick: onGlobePick,
    antipodeRelationArcCount: onAntipodeRelationArcCount,
    antipodeRelationFocusEvidence: onAntipodeRelationFocusEvidence,
    antipodeCityMarkerSize: onAntipodeCityMarkerSize,
  } = diagnostics;
  const activeMode = useAppStore((state) => state.activeMode);
  const point = useAppStore((state) => state.point);
  const selectedCountry = useAppStore((state) => state.selectedCountry);
  const hoveredCountry = useAppStore((state) => state.hoveredCountry);
  const cameraTarget = useAppStore((state) => state.cameraFocusIntent.target);
  const hasInteracted = useAppStore((state) => state.hasInteracted);
  const hasMeaningfulInteraction = useAppStore(
    (state) => state.hasMeaningfulInteraction,
  );
  const selectPoint = useAppStore((state) => state.selectPoint);
  const markInteraction = useAppStore((state) => state.markInteraction);
  const markMeaningfulInteraction = useAppStore(
    (state) => state.markMeaningfulInteraction,
  );
  const setCameraFocusFree = useAppStore((state) => state.setCameraFocusFree);
  const requestCameraFocus = useAppStore((state) => state.requestCameraFocus);
  const setSelectedCountry = useAppStore((state) => state.setSelectedCountry);
  const setHoveredCountry = useAppStore((state) => state.setHoveredCountry);
  const clearCameraTarget = useAppStore((state) => state.clearCameraTarget);
  const group = useRef<Group>(null);
  const interactionStart = useRef<Vector3>(null);
  const lastUserGestureAt = useRef(0);
  const orbitControls = useRef<OrbitControlsHandle | null>(null);
  const cameraFocusAnimation = useRef<{
    target: GeoPoint;
    startedAt: number;
    startDirection: Vector3;
    targetDirection: Vector3;
  } | null>(null);
  const cameraFocusRequest = useRef<{
    target: GeoPoint;
    startedAt: number;
  } | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const cameraFocusGeneration = useRef(0);
  const cameraOwner = useRef<'idle' | 'focus' | 'user'>('idle');
  // OrbitControls and the programmatic focus animation both write to the
  // camera. Once the user starts a gesture, the gesture owns the camera until
  // the focus target is cleared from the store.
  const manualCameraInteraction = useRef(false);
  // Zustand updates and React renders are asynchronous relative to an
  // OrbitControls pointer gesture. Keep the imperative camera loop's target
  // in sync immediately so a just-cleared focus cannot reassert itself on the
  // next frame and pull the globe back in the opposite direction.
  const cameraTargetRef = useRef<GeoPoint | null>(cameraTarget);
  useEffect(() => {
    cameraTargetRef.current = cameraTarget;
  }, [cameraTarget]);
  const surnameFocusKey = useRef('');
  const surnameFocusAttempt = useRef({ countryId: '', nextOffsetIndex: 0 });
  const surnameScaleAttempt = useRef({ countryId: '', count: 0 });
  const markerDiagnostic = useRef<MarkerDiagnosticHandle>(null);
  const antipodeRelationDiagnostic =
    useRef<AntipodeRelationDiagnosticHandle>(null);
  const sunlineDiagnostic = useRef<SunlineDiagnosticHandle>(null);
  const outerShell = useRef<Mesh>(null);
  const outerMaterial = useRef<MeshStandardMaterial>(null);
  const baseSurface = useRef<Mesh>(null);
  const baseMaterial = useRef<MeshStandardMaterial>(null);
  const highlightMesh = useRef<Mesh>(null);
  const highlightMaterial = useRef<MeshBasicMaterial>(null);
  const innerWall = useRef<Mesh>(null);
  const innerMaterial = useRef<MeshBasicMaterial>(null);
  const [vectorReady, setVectorReady] = useState(false);
  // Keep the gesture gate synchronous with the pointer event. React state can
  // commit after OrbitControls has already emitted its first drag frame.
  const cameraGestureActiveRef = useRef(false);
  const [surnameSlotOverrides, setSurnameSlotOverrides] = useState<
    Readonly<Record<string, SurnameLabelSlot>>
  >({});
  const { camera, gl, invalidate, size } = useThree();
  const surnameOverrideKey = `${selectedCountry?.countryId ?? ''}:${surnameDisplayMode}:${size.width}:${size.height}`;
  const clearCameraFocus = useCallback(() => {
    cameraFocusGeneration.current += 1;
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    cameraFocusRequest.current = null;
    cameraFocusAnimation.current = null;
    cameraTargetRef.current = null;
    cameraOwner.current = 'idle';
    manualCameraInteraction.current = false;
    interactionStart.current = null;
    cameraGestureActiveRef.current = false;
    if (orbitControls.current) orbitControls.current.enabled = true;
    clearCameraTarget();
  }, [clearCameraTarget]);
  useEffect(() => {
    cameraGestureCancelRef.current = clearCameraFocus;
    return () => {
      if (cameraGestureCancelRef.current === clearCameraFocus) {
        cameraGestureCancelRef.current = null;
      }
    };
  }, [cameraGestureCancelRef, clearCameraFocus]);
  const onCameraFocusStartRef = useRef(onCameraFocusStart);
  const onCameraFocusAnimationStartRef = useRef(onCameraFocusAnimationStart);
  const invalidateRef = useRef(invalidate);
  useEffect(() => {
    onCameraFocusStartRef.current = onCameraFocusStart;
    onCameraFocusAnimationStartRef.current = onCameraFocusAnimationStart;
    invalidateRef.current = invalidate;
  }, [invalidate, onCameraFocusAnimationStart, onCameraFocusStart]);
  const reducedMotion = useReducedMotion();
  const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
  const countries = useMemo(() => getCountryDataset(), []);
  const surnameRuntime = useSurnameAtlasRuntime(activeMode === 'surnames');
  const surnameCountries =
    activeMode === 'surnames' && surnameRuntime
      ? surnameRuntime.surnameCountries
      : NO_COUNTRIES;
  const selectedSurnameMapLabel = useMemo(
    () =>
      surnameMapLabels.find(
        (label) => label.countryId === selectedCountry?.countryId,
      ) ?? null,
    [selectedCountry?.countryId, surnameMapLabels],
  );
  const surnameAnchor = useMemo(() => {
    if (!selectedSurnameMapLabel) return null;
    const country = surnameCountries.find(
      (candidate) =>
        candidate.properties.countryId === selectedSurnameMapLabel.countryId,
    );
    return country
      ? getCountryLabelAnchor(country)
      : getCountryLabelAnchorForId(selectedSurnameMapLabel.countryId);
  }, [selectedSurnameMapLabel, surnameCountries]);
  const renderedCountriesById = useMemo(
    () =>
      new Map(
        countries.countries.features.map((feature) => [
          feature.properties.countryId,
          feature,
        ]),
      ),
    [countries],
  );
  const surnameLabelEntries = useMemo(() => {
    // Do not block the vector asset request on the CPU geometry pass. The
    // labels are mounted only after the vector surface is ready, so computing
    // them before that point only delays the ready signal.
    if (!vectorReady || !surnameRuntime) return [];
    const countriesById = new Map(
      surnameCountries.map((candidate) => [
        candidate.properties.countryId,
        candidate,
      ]),
    );
    return surnameMapLabels.flatMap((label) => {
      const country = countriesById.get(label.countryId);
      const anchor = country
        ? (getCountryLabelAnchor(country) ??
          getCountryLabelAnchorForId(label.countryId))
        : getCountryLabelAnchorForId(label.countryId);
      if (!anchor) return [];
      const wordmark = resolveSurnameWordmark(label.record, surnameDisplayMode);
      if (!wordmark) return [];
      const slot =
        (surnameSlotOverrides[`${surnameOverrideKey}:${label.countryId}`]
          ?.layout === wordmark.layout
          ? surnameSlotOverrides[`${surnameOverrideKey}:${label.countryId}`]
          : null) ??
        surnameRuntime.chooseSurnameLabelSlot(
          label.countryId,
          anchor,
          wordmark,
          surnameCountries,
        );
      if (
        !slot ||
        !surnameRuntime.isSurnameLabelSlotOnRenderedLand(
          slot,
          label.countryId,
          profile.vectorDetail,
          renderedCountriesById,
        )
      ) {
        return [];
      }
      return [
        {
          label: {
            ...label,
            countryName: country?.properties.name ?? label.countryName,
          },
          anchor,
          slot,
          wordmark,
        },
      ];
    });
  }, [
    profile.vectorDetail,
    renderedCountriesById,
    surnameCountries,
    surnameDisplayMode,
    surnameMapLabels,
    surnameRuntime,
    surnameSlotOverrides,
    surnameOverrideKey,
    vectorReady,
  ]);
  const selectedSurnameSlot = useMemo(
    () =>
      surnameLabelEntries.find(
        (entry) => entry.label.countryId === selectedCountry?.countryId,
      )?.slot ?? null,
    [selectedCountry?.countryId, surnameLabelEntries],
  );
  useEffect(() => {
    if (activeMode !== 'surnames') {
      surnameFocusKey.current = '';
      surnameFocusAttempt.current = { countryId: '', nextOffsetIndex: 0 };
      surnameScaleAttempt.current = { countryId: '', count: 0 };
      return;
    }
    if (
      !selectedSurnameMapLabel ||
      !surnameAnchor ||
      surnameFocusKey.current === selectedSurnameMapLabel.countryId
    ) {
      return;
    }
    surnameFocusKey.current = selectedSurnameMapLabel.countryId;
    surnameFocusAttempt.current = {
      countryId: selectedSurnameMapLabel.countryId,
      nextOffsetIndex: 0,
    };
    surnameScaleAttempt.current = {
      countryId: selectedSurnameMapLabel.countryId,
      count: 0,
    };
    requestCameraFocus(
      getSurnameCameraFocusPoint(
        selectedSurnameSlot?.center ?? surnameAnchor.point,
        typeof window !== 'undefined' && window.innerWidth <= 760 ? 18 : 0,
      ),
    );
  }, [
    activeMode,
    requestCameraFocus,
    selectedSurnameMapLabel,
    selectedSurnameSlot,
    surnameAnchor,
  ]);
  const handleSelectedSurnameLabelBlocked = useCallback(() => {
    const compactViewport = window.innerWidth <= 760;
    const userGestureRecentlyEnded =
      performance.now() - lastUserGestureAt.current < 6000;
    const userOwnsCamera =
      manualCameraInteraction.current ||
      hasMeaningfulInteraction ||
      userGestureRecentlyEnded;
    if (
      userOwnsCamera &&
      activeMode === 'surnames' &&
      selectedSurnameMapLabel &&
      selectedSurnameSlot
    ) {
      const scaleAttempt = surnameScaleAttempt.current;
      if (scaleAttempt.countryId !== selectedSurnameMapLabel.countryId) {
        scaleAttempt.countryId = selectedSurnameMapLabel.countryId;
        scaleAttempt.count = 0;
      }
      if (scaleAttempt.count < 4) {
        scaleAttempt.count += 1;
        setSurnameSlotOverrides((current) => ({
          ...current,
          [`${surnameOverrideKey}:${selectedSurnameMapLabel.countryId}`]: {
            ...selectedSurnameSlot,
            maxAngularDegrees: Math.max(
              0.18,
              selectedSurnameSlot.maxAngularDegrees * 0.68,
            ),
            squareMax:
              selectedSurnameSlot.squareMax === undefined
                ? undefined
                : Math.max(0.18, selectedSurnameSlot.squareMax * 0.68),
          },
        }));
        return;
      }
    }
    if (
      activeMode === 'surnames' &&
      selectedSurnameMapLabel &&
      surnameAnchor &&
      selectedSurnameSlot &&
      (!compactViewport ||
        manualCameraInteraction.current ||
        hasMeaningfulInteraction ||
        userGestureRecentlyEnded)
    ) {
      const selectedWordmark = resolveSurnameWordmark(
        selectedSurnameMapLabel.record,
        surnameDisplayMode,
      );
      const candidate =
        selectedWordmark && surnameRuntime
          ? surnameRuntime.chooseAlternativeSurnameLabelSlot(
              selectedSurnameMapLabel.countryId,
              surnameAnchor,
              selectedWordmark,
              surnameCountries,
              selectedSurnameSlot,
            )
          : null;
      const alternate =
        candidate &&
        surnameRuntime?.isSurnameLabelSlotOnRenderedLand(
          candidate,
          selectedSurnameMapLabel.countryId,
          profile.vectorDetail,
          renderedCountriesById,
        )
          ? candidate
          : null;
      if (alternate) {
        surnameFocusAttempt.current.nextOffsetIndex = 0;
        setSurnameSlotOverrides((current) => ({
          ...current,
          [`${surnameOverrideKey}:${selectedSurnameMapLabel.countryId}`]:
            alternate,
        }));
        if (
          !manualCameraInteraction.current &&
          !hasMeaningfulInteraction &&
          !userGestureRecentlyEnded
        ) {
          requestCameraFocus(getSurnameCameraFocusPoint(alternate.center));
        }
        return;
      }
    }
    // On compact layouts the header and intro occupy the upper half of the
    // globe canvas. Re-center the selected country below that shell before
    // spending time evaluating alternate slots; otherwise each candidate can
    // be individually safe yet still land under the same full-width panel.
    if (
      compactViewport &&
      activeMode === 'surnames' &&
      !manualCameraInteraction.current &&
      !hasMeaningfulInteraction &&
      !userGestureRecentlyEnded &&
      selectedSurnameMapLabel &&
      surnameAnchor
    ) {
      const offset =
        SURNAME_FOCUS_RETRY_OFFSETS[
          surnameFocusAttempt.current.nextOffsetIndex
        ] ?? null;
      if (offset !== null) {
        surnameFocusAttempt.current.nextOffsetIndex += 1;
        requestCameraFocus(
          getSurnameCameraFocusPoint(
            selectedSurnameSlot?.center ?? surnameAnchor.point,
            Math.abs(offset),
          ),
        );
        return;
      }
    }
    if (
      activeMode !== 'surnames' ||
      manualCameraInteraction.current ||
      hasMeaningfulInteraction ||
      userGestureRecentlyEnded ||
      !selectedSurnameMapLabel ||
      !surnameAnchor ||
      typeof window === 'undefined'
    ) {
      return;
    }
    const attempt = surnameFocusAttempt.current;
    if (attempt.countryId !== selectedSurnameMapLabel.countryId) return;
    const offset = SURNAME_FOCUS_RETRY_OFFSETS[attempt.nextOffsetIndex] ?? null;
    if (offset === null) return;
    attempt.nextOffsetIndex += 1;
    requestCameraFocus(
      getSurnameCameraFocusPoint(
        selectedSurnameSlot?.center ?? surnameAnchor.point,
        offset,
      ),
    );
  }, [
    activeMode,
    hasMeaningfulInteraction,
    profile.vectorDetail,
    renderedCountriesById,
    requestCameraFocus,
    selectedSurnameMapLabel,
    selectedSurnameSlot,
    surnameCountries,
    surnameOverrideKey,
    surnameRuntime,
    setSurnameSlotOverrides,
    surnameAnchor,
    surnameDisplayMode,
  ]);
  const rasterCountryFills = vectorReady ? null : countryFills;
  const texture = useMemo(
    () =>
      createCountryTexture(
        countries,
        profile.textureWidth,
        rasterCountryFills,
        maxAnisotropy,
      ),
    [countries, profile.textureWidth, rasterCountryFills, maxAnisotropy],
  );
  const highlights = useMemo(
    () =>
      createCountryHighlightTexture(
        countries,
        profile.textureWidth,
        maxAnisotropy,
      ),
    [countries, profile.textureWidth, maxAnisotropy],
  );
  const handleVectorStateChange = useCallback(
    (state: VectorGlobeState, resources: VectorGlobeResources | null) => {
      setVectorReady(state === 'ready');
      onVectorStateChange(state, resources);
    },
    [onVectorStateChange],
  );

  const relationOrigin = antipodeRelation?.origin.exactPoint ?? point;
  const relationAntipode =
    antipodeRelation?.antipode.exactPoint ?? antipodeOf(point);
  const primary = useMemo(
    () => geoToVector3(relationOrigin, 1.003),
    [relationOrigin],
  );
  const antipode = useMemo(
    () => geoToVector3(relationAntipode, 1.0035),
    [relationAntipode],
  );
  const crossSection = useMemo(
    () => createAntipodeCrossSection(primary),
    [primary],
  );
  const sunDirection = useMemo(
    () =>
      sunline ? geoToVector3(sunline.subsolarPoint).normalize() : new Vector3(),
    [sunline],
  );
  const selectedMarkerPosition = useMemo(
    () => geoToVector3(point, SUNLINE_RENDERING.selectedMarker.radius),
    [point],
  );
  const sunLightPosition = useMemo(
    () => sunDirection.clone().multiplyScalar(4),
    [sunDirection],
  );
  const solarMarkerPosition = useMemo(
    () =>
      sunDirection.clone().multiplyScalar(SUNLINE_RENDERING.solarMarker.radius),
    [sunDirection],
  );

  useImperativeHandle(keyboardController, () => {
    function finishCameraMove() {
      manualCameraInteraction.current = true;
      cameraFocusAnimation.current = null;
      cameraFocusRequest.current = null;
      cameraTargetRef.current = null;
      cameraOwner.current = 'idle';
      if (orbitControls.current) orbitControls.current.enabled = true;
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      // Keep OrbitControls' cached spherical state aligned with keyboard and
      // programmatic camera moves before the next pointer gesture takes over.
      orbitControls.current?.update();
      markerDiagnostic.current?.request('interaction');
      antipodeRelationDiagnostic.current?.request('interaction');
      sunlineDiagnostic.current?.request('interaction');
      onCameraFocusStart();
      setCameraFocusFree();
      manualCameraInteraction.current = false;
      markMeaningfulInteraction();
      invalidate();
    }

    return {
      rotateHorizontal(radians) {
        camera.position.applyAxisAngle(new Vector3(0, 1, 0), radians);
        finishCameraMove();
      },
      rotateVertical(radians) {
        rotateCameraVertically(camera.position, radians);
        finishCameraMove();
      },
      zoom(factor) {
        camera.position.setLength(
          clampGlobeCameraDistance(camera.position.length() * factor),
        );
        finishCameraMove();
      },
      selectCenter() {
        if (!group.current) return;
        const center = vector3ToGeo(
          group.current.worldToLocal(camera.position.clone()).normalize(),
        );
        selectPoint(center);
        setSelectedCountry(countries.findCountry(center));
        invalidate();
      },
      cancelCameraGesture: clearCameraFocus,
    };
  }, [
    camera,
    countries,
    invalidate,
    markMeaningfulInteraction,
    onCameraFocusStart,
    selectPoint,
    setSelectedCountry,
    setCameraFocusFree,
    clearCameraFocus,
  ]);

  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => () => highlights.texture.dispose(), [highlights]);
  useEffect(() => {
    if (!cameraTarget) {
      cameraFocusGeneration.current += 1;
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
      cameraFocusRequest.current = null;
      cameraFocusAnimation.current = null;
      cameraTargetRef.current = null;
      if (cameraOwner.current === 'focus') cameraOwner.current = 'idle';
      if (cameraOwner.current !== 'user' && orbitControls.current) {
        orbitControls.current.enabled = true;
      }
      return;
    }
    if (manualCameraInteraction.current) return;
    const generation = ++cameraFocusGeneration.current;
    cameraTargetRef.current = cameraTarget;
    manualCameraInteraction.current = false;
    cameraOwner.current = 'focus';
    if (orbitControls.current) orbitControls.current.enabled = false;
    cameraFocusRequest.current = {
      target: cameraTarget,
      startedAt: performance.now(),
    };
    onCameraFocusAnimationStartRef.current(
      cameraFocusRequest.current.startedAt,
    );
    const startedAt = cameraFocusRequest.current.startedAt;
    const requestFocusFrame = (timestamp: number) => {
      invalidateRef.current();
      if (
        generation !== cameraFocusGeneration.current ||
        cameraOwner.current !== 'focus'
      ) {
        focusFrameRef.current = null;
        return;
      }
      if (timestamp - startedAt <= CAMERA_FOCUS_DURATION_MS) {
        focusFrameRef.current = requestAnimationFrame(requestFocusFrame);
      } else {
        focusFrameRef.current = null;
      }
    };
    focusFrameRef.current = requestAnimationFrame(requestFocusFrame);
    return () => {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
    };
  }, [cameraTarget]);
  useEffect(() => {
    if (!showAntipodes) return;
    markerDiagnostic.current?.request('point');
    antipodeRelationDiagnostic.current?.request('point');
    invalidate();
  }, [invalidate, point, showAntipodes]);
  useEffect(() => {
    invalidate();
  }, [antipodeDragActive, invalidate]);
  useEffect(() => {
    if (!showAntipodes) return;
    const outerMesh = outerShell.current;
    const outer = outerMaterial.current;
    const innerMesh = innerWall.current;
    const inner = innerMaterial.current;
    const baseMesh = baseSurface.current;
    const base = baseMaterial.current;
    const highlight = highlightMesh.current;
    const highlightSurface = highlightMaterial.current;
    if (
      !outerMesh ||
      !outer ||
      !innerMesh ||
      !inner ||
      !baseMesh ||
      !base ||
      !highlight ||
      !highlightSurface
    )
      return;
    onAntipodeSceneDiagnostic(
      {
        side: outer.side,
        depthWrite: outer.depthWrite,
        renderOrder: outerMesh.renderOrder,
        radius: outerMesh.scale.x,
      },
      {
        side: inner.side,
        depthWrite: inner.depthWrite,
        renderOrder: innerMesh.renderOrder,
        radius: innerMesh.scale.x,
      },
    );
    onAntipodeLayerDiagnostic(
      `visible:${!antipodeDragActive && (vectorReady || baseMesh.visible)},transparent:${base.transparent},depthWrite:${base.depthWrite},renderOrder:${baseMesh.renderOrder},radius:${baseMesh.scale.x}`,
      String(antipodeDragActive && (vectorReady || outerMesh.visible)),
      `visible:${vectorReady || highlight.visible},renderOrder:${highlight.renderOrder},radius:${highlight.scale.x},depthWrite:${highlightSurface.depthWrite}`,
    );
  }, [
    antipodeDragActive,
    onAntipodeLayerDiagnostic,
    onAntipodeSceneDiagnostic,
    showAntipodes,
    vectorReady,
  ]);
  useEffect(() => {
    if (vectorReady) return;
    highlights.update(
      hoveredCountry?.countryId ?? null,
      selectedCountry?.countryId ?? null,
    );
    invalidate();
  }, [
    highlights,
    hoveredCountry?.countryId,
    invalidate,
    selectedCountry?.countryId,
    vectorReady,
  ]);

  useFrame((_, delta) => {
    const activeCameraTarget = cameraTargetRef.current;
    if (benchmarkActive) {
      recordBenchmarkFrame(performance.now());
      invalidate();
    }
    if (
      activeMode !== 'surnames' &&
      !hasInteracted &&
      !manualCameraInteraction.current &&
      !reducedMotion &&
      group.current
    ) {
      group.current.rotation.y += delta * 0.035;
      invalidate();
    }
    if (
      activeCameraTarget &&
      !manualCameraInteraction.current &&
      cameraOwner.current !== 'user' &&
      group.current
    ) {
      const cameraDistance = clampGlobeCameraDistance(camera.position.length());
      const currentDirection = camera.position.clone().normalize();
      if (cameraFocusAnimation.current?.target !== activeCameraTarget) {
        cameraFocusAnimation.current = {
          target: activeCameraTarget,
          startedAt:
            cameraFocusRequest.current?.target === activeCameraTarget
              ? cameraFocusRequest.current.startedAt
              : performance.now(),
          startDirection: currentDirection,
          targetDirection: geoToVector3(activeCameraTarget)
            .applyQuaternion(group.current.quaternion)
            .normalize(),
        };
      }
      const animation = cameraFocusAnimation.current;
      animation.targetDirection
        .copy(geoToVector3(activeCameraTarget))
        .applyQuaternion(group.current.quaternion)
        .normalize();
      const { progress, complete } = cameraFocusAnimationProgress(
        animation.startedAt,
        performance.now(),
      );
      const targetDirection = animation.targetDirection;
      const remaining = currentDirection.angleTo(targetDirection);
      if (complete || remaining < 0.003 || reducedMotion) {
        camera.position.copy(targetDirection.multiplyScalar(cameraDistance));
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        orbitControls.current?.update();
        markerDiagnostic.current?.request('camera-focus');
        antipodeRelationDiagnostic.current?.request(
          'camera-focus',
          activeCameraTarget,
        );
        sunlineDiagnostic.current?.request('camera-focus');
        onCameraFocusComplete(
          vector3ToGeo(
            group.current.worldToLocal(camera.position.clone()).normalize(),
          ),
          reducedMotion ? 'instant' : 'animated',
          performance.now() - animation.startedAt,
        );
        const originCity =
          antipodeRelation?.origin.nearestMajorCity?.city.point;
        const antipodeCity =
          antipodeRelation?.antipode.nearestMajorCity?.city.point;
        const matchesTarget = (candidate: GeoPoint | undefined) =>
          candidate?.latitude === activeCameraTarget.latitude &&
          candidate.longitude === activeCameraTarget.longitude;
        const focusedSide =
          matchesTarget(relationOrigin) || matchesTarget(originCity)
            ? antipodeRelation?.origin
            : matchesTarget(relationAntipode) || matchesTarget(antipodeCity)
              ? antipodeRelation?.antipode
              : null;
        if (focusedSide?.nearestMajorCity) {
          const focusedCity = matchesTarget(
            focusedSide.nearestMajorCity.city.point,
          );
          const markerPoint = focusedCity
            ? focusedSide.nearestMajorCity.city.point
            : focusedSide.exactPoint;
          const markerRadius = focusedCity
            ? 1.021
            : focusedSide === antipodeRelation?.antipode
              ? 1.0035
              : 1.003;
          group.current.updateWorldMatrix(true, false);
          camera.updateMatrixWorld();
          const markerWorld = geoToVector3(
            markerPoint,
            markerRadius,
          ).applyMatrix4(group.current.matrixWorld);
          const marker = markerWorld.clone().project(camera);
          const markerFrontFacing =
            markerWorld
              .clone()
              .normalize()
              .dot(camera.position.clone().sub(markerWorld)) > 0;
          const inViewport = (projected: Vector3) =>
            projected.z >= -1 &&
            projected.z <= 1 &&
            Math.abs(projected.x) <= 1 &&
            Math.abs(projected.y) <= 1;
          onAntipodeRelationFocusEvidence(
            `markerTarget:${formatDiagnosticCoordinate(markerPoint.latitude)},${formatDiagnosticCoordinate(markerPoint.longitude)},markerRadius:${markerRadius},markerFrontFacing:${markerFrontFacing},markerInViewport:${inViewport(marker)}`,
          );
        }
        clearCameraTarget(activeCameraTarget);
        cameraTargetRef.current = null;
        cameraFocusRequest.current = null;
        cameraFocusAnimation.current = null;
        cameraOwner.current = 'idle';
        if (orbitControls.current) orbitControls.current.enabled = true;
      } else {
        const rotation = new Quaternion().setFromUnitVectors(
          animation.startDirection,
          targetDirection,
        );
        const partial = new Quaternion().slerp(rotation, progress);
        camera.position
          .copy(animation.startDirection.clone().applyQuaternion(partial))
          .multiplyScalar(cameraDistance);
      }
      camera.lookAt(0, 0, 0);
      orbitControls.current?.update();
      invalidate();
    }
  });

  const handleOrbitStart = useCallback(() => {
    lastUserGestureAt.current = performance.now();
    interactionStart.current = camera.position.clone();
    manualCameraInteraction.current = true;
    cameraFocusGeneration.current += 1;
    cameraOwner.current = 'user';
    cameraGestureActiveRef.current = true;
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    cameraFocusAnimation.current = null;
    cameraFocusRequest.current = null;
    cameraTargetRef.current = null;
    if (orbitControls.current) orbitControls.current.enabled = true;
    onCameraFocusStart();
    clearCameraTarget();
    markInteraction();
  }, [camera, clearCameraTarget, markInteraction, onCameraFocusStart]);

  const handleOrbitChange = useCallback(() => {
    invalidate();
  }, [invalidate]);

  const handleOrbitEnd = useCallback(() => {
    lastUserGestureAt.current = performance.now();
    if (
      interactionStart.current &&
      interactionStart.current.distanceToSquared(camera.position) > 1e-8
    ) {
      markMeaningfulInteraction();
      setCameraFocusFree();
      onUserCameraMove();
    }
    manualCameraInteraction.current = false;
    cameraFocusGeneration.current += 1;
    cameraTargetRef.current = null;
    clearCameraTarget();
    cameraOwner.current = 'idle';
    cameraGestureActiveRef.current = false;
    interactionStart.current = null;
    markerDiagnostic.current?.request('interaction');
    antipodeRelationDiagnostic.current?.request('interaction');
    sunlineDiagnostic.current?.request('interaction');
    invalidate();
  }, [
    camera,
    clearCameraTarget,
    invalidate,
    markMeaningfulInteraction,
    onUserCameraMove,
    setCameraFocusFree,
  ]);

  function handleSelect(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onHitSpherePick();
    const threshold =
      event.pointerType === 'touch' ? TOUCH_CLICK_DRAG_THRESHOLD_PX : undefined;
    if (!isSelectionGesture(event.delta, threshold)) {
      markMeaningfulInteraction();
      return;
    }
    if (!group.current) return;
    const selectedPoint = vector3ToGeo(
      group.current.worldToLocal(event.point.clone()),
    );
    onGlobePick(selectedPoint);
    selectPoint(selectedPoint);
    setSelectedCountry(countries.findCountry(selectedPoint));
    invalidate();
  }

  function handleHover(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    // OrbitControls owns pointer movement during a camera gesture. Country
    // hit-testing walks geographic polygons and offers no useful hover result
    // while the globe itself is moving.
    if (cameraGestureActiveRef.current || pointerActiveRef.current) return;
    if (!group.current) return;
    const hoverPoint = vector3ToGeo(
      group.current.worldToLocal(event.point.clone()),
    );
    setHoveredCountry(countries.findCountry(hoverPoint));
  }

  return (
    <>
      <ambientLight
        intensity={GLOBE_RENDERING.ambient.intensity}
        color={GLOBE_RENDERING.ambient.color}
      />
      <directionalLight
        position={[-3, 2, 4]}
        intensity={GLOBE_RENDERING.directional.intensity}
        color={GLOBE_RENDERING.directional.color}
      />
      <group ref={group}>
        {sunline ? (
          <directionalLight
            position={sunLightPosition}
            intensity={0.28}
            color="#f1d69a"
          />
        ) : null}
        <mesh
          onPointerEnter={onHitSpherePick}
          onClick={handleSelect}
          onPointerMove={handleHover}
          onPointerOut={() => setHoveredCountry(null)}
        >
          <sphereGeometry args={[1, ...profile.sphereSegments]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <VectorGlobeLayer
          profile={profile}
          countryFills={countryFills}
          hoveredCountryId={hoveredCountry?.countryId ?? null}
          selectedCountryId={selectedCountry?.countryId ?? null}
          dragActive={antipodeDragActive}
          onStateChange={handleVectorStateChange}
          onPaletteUpdate={onVectorPaletteUpdate}
          onDragMaterialChange={onVectorDragMaterialChange}
          onDragEvidence={onVectorDragEvidence}
          sunlineActive={Boolean(sunline)}
          onSunlineHighlightChange={onVectorSunlineHighlightChange}
          onRenderEvidence={onVectorRenderEvidence}
          renderSampleKey={vectorRenderSampleKey}
        />
        {vectorReady && surnameLabelEntries.length > 0 ? (
          <SurnameMapLabelLayer
            key={`surname-label-layer:${surnameDisplayMode}`}
            entries={surnameLabelEntries}
            displayMode={surnameDisplayMode}
            selectedCountryId={selectedCountry?.countryId ?? null}
            cameraFocusTarget={cameraTarget}
            onVisibilityChange={onSurnameLabelVisibilityChange}
            onLayoutChange={onSurnameLabelLayoutChange}
            onSelectedLabelBlocked={handleSelectedSurnameLabelBlocked}
            cameraGestureActiveRef={cameraGestureActiveRef}
            pointerActiveRef={pointerActiveRef}
            globeGroupRef={group}
          />
        ) : null}
        <mesh
          ref={baseSurface}
          visible={!vectorReady && !antipodeDragActive}
          renderOrder={0}
          raycast={ignoreRaycast}
        >
          <sphereGeometry args={[1, ...profile.sphereSegments]} />
          <meshStandardMaterial
            ref={baseMaterial}
            map={texture}
            roughness={GLOBE_RENDERING.material.roughness}
            metalness={GLOBE_RENDERING.material.metalness}
            depthTest
            depthWrite
          />
        </mesh>
        <mesh
          ref={outerShell}
          visible={!vectorReady && antipodeDragActive}
          renderOrder={ANTIPODE_DRAG_RENDERING.outerShell.renderOrder}
          raycast={ignoreRaycast}
        >
          <sphereGeometry args={[1, ...profile.sphereSegments]} />
          <meshStandardMaterial
            ref={outerMaterial}
            map={texture}
            roughness={GLOBE_RENDERING.material.roughness}
            metalness={GLOBE_RENDERING.material.metalness}
            color={ANTIPODE_DRAG_RENDERING.outerShell.color}
            transparent
            opacity={ANTIPODE_DRAG_RENDERING.outerShell.dragOpacity}
            side={ANTIPODE_DRAG_RENDERING.outerShell.side}
            depthTest={ANTIPODE_DRAG_RENDERING.outerShell.depthTest}
            depthWrite={ANTIPODE_DRAG_RENDERING.outerShell.depthWrite}
          />
        </mesh>
        <mesh
          ref={innerWall}
          visible={antipodeDragActive}
          scale={ANTIPODE_DRAG_RENDERING.innerWall.radius}
          renderOrder={ANTIPODE_DRAG_RENDERING.innerWall.renderOrder}
          raycast={ignoreRaycast}
        >
          <sphereGeometry args={[1, ...profile.sphereSegments]} />
          <meshBasicMaterial
            ref={innerMaterial}
            color={ANTIPODE_DRAG_RENDERING.innerWall.color}
            transparent
            opacity={ANTIPODE_DRAG_RENDERING.innerWall.opacity}
            side={ANTIPODE_DRAG_RENDERING.innerWall.side}
            depthTest={ANTIPODE_DRAG_RENDERING.innerWall.depthTest}
            depthWrite={ANTIPODE_DRAG_RENDERING.innerWall.depthWrite}
          />
        </mesh>
        <mesh
          ref={highlightMesh}
          visible={!vectorReady}
          scale={
            sunline
              ? SUNLINE_RENDERING.highlight.radius
              : ANTIPODE_DRAG_RENDERING.highlight.radius
          }
          renderOrder={
            sunline
              ? SUNLINE_RENDERING.highlight.renderOrder
              : ANTIPODE_DRAG_RENDERING.highlight.renderOrder
          }
          raycast={ignoreRaycast}
        >
          <sphereGeometry args={[1, ...profile.sphereSegments]} />
          <meshBasicMaterial
            ref={highlightMaterial}
            map={highlights.texture}
            transparent
            depthTest
            depthWrite={false}
          />
        </mesh>
        <GeographicGraticule sunline={Boolean(sunline)} />
        {sunline ? (
          <>
            <SunlineLayer
              sunDirection={sunDirection}
              solarMarkerPosition={solarMarkerPosition}
              sphereSegments={profile.sphereSegments}
            />
            <SunlineProjectionDiagnostic
              ref={sunlineDiagnostic}
              globeGroup={group}
              selectedPosition={selectedMarkerPosition}
              selectedSurfacePosition={primary}
              solarPosition={solarMarkerPosition}
              onDiagnostic={onSunlineProjectionDiagnostic}
            />
            <Marker
              position={selectedMarkerPosition}
              color={GLOBE_COLOR_CONTRACT.sunline.selected}
              centerColor={GLOBE_COLOR_CONTRACT.sunline.selected}
              role="selected"
              targetCssPixels={SUNLINE_RENDERING.selectedMarker.cssDiameter}
              renderOrder={SUNLINE_RENDERING.selectedMarker.renderOrder}
              depthTest={SUNLINE_RENDERING.selectedMarker.depthTest}
              depthWrite={SUNLINE_RENDERING.selectedMarker.depthWrite}
            />
          </>
        ) : null}
        {showAntipodes ? (
          <>
            <Marker
              position={primary}
              color={GLOBE_COLOR_CONTRACT.origin.outer}
              centerColor={GLOBE_COLOR_CONTRACT.origin.center}
              role="origin"
              point={relationOrigin}
              diagnosticHandle={markerDiagnostic}
              onDiagnostic={onMarkerDiagnostic}
            />
            <Marker
              position={antipode}
              color={GLOBE_COLOR_CONTRACT.antipode.outer}
              centerColor={GLOBE_COLOR_CONTRACT.antipode.center}
              role="antipode"
            />
            <AntipodeCrossSection section={crossSection} />
            {antipodeRelation ? (
              <AntipodeRelationLayer
                ref={antipodeRelationDiagnostic}
                relation={antipodeRelation}
                onArcCount={onAntipodeRelationArcCount}
                onMarkerSize={onAntipodeCityMarkerSize}
                onFocusEvidence={onAntipodeRelationFocusEvidence}
              />
            ) : null}
            <CenterCandleGlow
              active={antipodeDragActive}
              reducedMotion={reducedMotion}
              diagnosticsEnabled={dragDiagnosticsEnabled}
              onFrame={onCenterGlowFrame}
              onMode={onCenterGlowMode}
            />
          </>
        ) : null}
      </group>
      <OrbitControls
        ref={(controls) => {
          orbitControls.current = controls;
        }}
        enablePan={false}
        enableDamping={false}
        minDistance={GLOBE_CAMERA_DISTANCE.min}
        maxDistance={GLOBE_CAMERA_DISTANCE.max}
        rotateSpeed={0.55}
        zoomSpeed={0.65}
        onStart={handleOrbitStart}
        onChange={handleOrbitChange}
        onEnd={handleOrbitEnd}
        makeDefault
      />
    </>
  );
}

function GeographicGraticule({ sunline }: { sunline: boolean }) {
  const lines = useMemo(
    () => createGraticuleLines(sunline ? 1.018 : 1.006),
    [sunline],
  );

  return lines.map((line) => (
    <Line
      key={`${line.kind}-${line.coordinate}`}
      points={line.points}
      color={GLOBE_RENDERING.graticule.color}
      lineWidth={line.coordinate === 0 ? 0.85 : 0.55}
      transparent
      opacity={sunline ? 0.42 : GLOBE_RENDERING.graticule.opacity}
      depthTest
      renderOrder={3}
    />
  ));
}
