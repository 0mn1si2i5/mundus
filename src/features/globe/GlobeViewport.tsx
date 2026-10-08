import { Canvas } from '@react-three/fiber';
import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { MathUtils } from 'three';
import { useAppStore } from '../../state/appStore';
import { useFrameBenchmark } from '../performance/useFrameBenchmark';
import {
  CLICK_DRAG_THRESHOLD_PX,
  TOUCH_CLICK_DRAG_THRESHOLD_PX,
} from './interaction';
import { detectQualityProfile } from './quality';
import { SUNLINE_RENDERING } from './rendering';
import { supportsWebGL2 } from './webgl';
import styles from './GlobeViewport.module.css';
import type { AntipodeRelation } from '../antipodes/relation';
import { type VectorGlobeState } from './VectorGlobeLayer';
import type { VectorGlobeResources } from './vectorGlobe';
import { type SurnameLabelHiddenReason } from './surnameLabelLayout';
import type { SurnameMapLabel } from '../surnames/surnameData';
import { resolveSurnameWordmark } from '../surnames/surnameWordmark';
import type { SurnameDisplayMode } from '../../state/urlState';
import type { IsolationGlobePresentation } from '../modes/useModePresentation';
import { messages } from '../../i18n/messages';
import {
  clearCameraDiagnostic,
  createViewportDiagnostics,
  formatDiagnosticCoordinate,
  materialDiagnostic,
  resetViewportDiagnostics,
} from './viewportDiagnostics';
import {
  GlobeScene,
  type GlobeKeyboardController,
  type SunlineRenderState,
} from './GlobeScene';

export type { SunlineRenderState } from './GlobeScene';

function dragThreshold(pointerType: string) {
  return pointerType === 'touch'
    ? TOUCH_CLICK_DRAG_THRESHOLD_PX
    : CLICK_DRAG_THRESHOLD_PX;
}

interface GlobeViewportProps {
  diagnosticResetKey: string;
  fallbackLabel: string;
  contextLostLabel: string;
  ariaLabel: string;
  keyboardInstructions: string;
  keyboardMovedLabel: string;
  keyboardZoomedLabel: string;
  keyboardSelectedLabel: string;
  showAntipodes: boolean;
  sunline: SunlineRenderState | null;
  antipodeRelation: AntipodeRelation | null;
  surnameMapLabels: readonly SurnameMapLabel[];
  surnameDisplayMode: SurnameDisplayMode;
  isolation: IsolationGlobePresentation | null;
}

interface PointerStart {
  x: number;
  y: number;
  pointerType: string;
  dragging: boolean;
}

export function GlobeViewport({
  diagnosticResetKey,
  fallbackLabel,
  contextLostLabel,
  ariaLabel,
  keyboardInstructions,
  keyboardMovedLabel,
  keyboardZoomedLabel,
  keyboardSelectedLabel,
  showAntipodes,
  sunline,
  antipodeRelation,
  surnameMapLabels,
  surnameDisplayMode,
  isolation,
}: GlobeViewportProps) {
  const [supported] = useState(supportsWebGL2);
  const [profile] = useState(detectQualityProfile);
  const [dragDiagnosticsEnabled] = useState(() =>
    new URLSearchParams(window.location.search).has('dragDiagnostics'),
  );
  const [contextLost, setContextLost] = useState(false);
  const [vectorRenderSampleKey, setVectorRenderSampleKey] = useState(0);
  const [vectorState, setVectorState] = useState<VectorGlobeState>('loading');
  const [fieldRenderedAlpha, setFieldRenderedAlpha] = useState<number | null>(
    null,
  );
  const [vectorPaletteVersion, setVectorPaletteVersion] = useState(0);
  const [vectorGeometryId, setVectorGeometryId] = useState('');
  const [vectorDragTransparent, setVectorDragTransparent] = useState(false);
  const [vectorDragEvidence, setVectorDragEvidence] = useState('');
  const [vectorDragOrderEvidence, setVectorDragOrderEvidence] = useState('');
  const [vectorSunlineHighlight, setVectorSunlineHighlight] = useState<
    string | null
  >(null);
  const [surnameLabelVisible, setSurnameLabelVisible] = useState(false);
  const [surnameLabelLayout, setSurnameLabelLayout] = useState({
    entryCount: 0,
    visibleCount: 0,
    collisionCount: 0,
    selectedHiddenReason: null as SurnameLabelHiddenReason | null,
    minimumCornerRadius: 0,
    visibleRectangles: '',
  });
  const [vectorRenderEvidence, setVectorRenderEvidence] = useState<{
    vectorDraws: number;
    rendererCalls: number;
    revision: number;
  } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pointerActiveRef = useRef(false);
  const keyboardController = useRef<GlobeKeyboardController>(null);
  const cancelCameraGesture = useRef<(() => void) | null>(null);
  const [pointerStarts] = useState(() => new Map<number, PointerStart>());
  const [antipodeDragActive, setAntipodeDragActive] = useState(false);
  const [dragModeActive, setDragModeActive] = useState(showAntipodes);
  const [keyboardStatus, setKeyboardStatus] = useState('');
  const benchmark = useFrameBenchmark(profile.level);
  const markMeaningfulInteraction = useAppStore(
    (state) => state.markMeaningfulInteraction,
  );
  const setCameraFocusFree = useAppStore((state) => state.setCameraFocusFree);
  const point = useAppStore((state) => state.point);
  const locale = useAppStore((state) => state.locale);
  const selectedCountry = useAppStore((state) => state.selectedCountry);
  const selectedSurnameMapLabel = useMemo(
    () =>
      surnameMapLabels.find(
        (label) => label.countryId === selectedCountry?.countryId,
      ) ?? null,
    [selectedCountry?.countryId, surnameMapLabels],
  );
  const antipodeDragVisible = showAntipodes && antipodeDragActive;
  const handleVectorStateChange = useCallback(
    (state: VectorGlobeState, resources: VectorGlobeResources | null) => {
      setVectorState(state);
      setVectorGeometryId(resources?.surface.uuid ?? '');
    },
    [],
  );
  const handleVectorDragEvidence = useCallback(
    (alphaEvidence: string, orderEvidence: string) => {
      setVectorDragEvidence(alphaEvidence);
      setVectorDragOrderEvidence(orderEvidence);
    },
    [],
  );
  if (dragModeActive !== showAntipodes) {
    pointerStarts.clear();
    setAntipodeDragActive(false);
    setDragModeActive(showAntipodes);
  }

  const [diagnostics] = useState(createViewportDiagnostics);
  useLayoutEffect(() => {
    diagnostics.attach(viewport.current, showAntipodes);
  }, [diagnostics, showAntipodes]);

  function syncDragActive() {
    const active = Array.from(pointerStarts.values()).some(
      (pointer) => pointer.dragging,
    );
    setAntipodeDragActive((current) => (current === active ? current : active));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Cancel programmatic focus at the first user gesture, before
    // OrbitControls receives its own start event. This prevents a disabled
    // controls instance from letting focus animation win the first drag.
    // It runs in the capture phase: OrbitControls listens on the canvas
    // itself, which a bubbling React handler would only reach afterwards,
    // so the pointerdown that starts a drag during a focus animation was
    // dropped by the still-disabled controls.
    cancelCameraGesture.current?.();
    pointerActiveRef.current = true;
    pointerStarts.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
      dragging: false,
    });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = pointerStarts.get(event.pointerId);
    if (!start || start.dragging) return;
    if (
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >
      dragThreshold(start.pointerType)
    ) {
      start.dragging = true;
      syncDragActive();
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = pointerStarts.get(event.pointerId);
    pointerStarts.delete(event.pointerId);
    pointerActiveRef.current = pointerStarts.size > 0;
    syncDragActive();
    if (!start) return;
    const distance = Math.hypot(
      event.clientX - start.x,
      event.clientY - start.y,
    );
    if (distance > dragThreshold(start.pointerType)) {
      clearCameraDiagnostic(viewport.current);
      markMeaningfulInteraction();
      setCameraFocusFree();
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    pointerStarts.delete(event.pointerId);
    pointerActiveRef.current = pointerStarts.size > 0;
    syncDragActive();
    cancelCameraGesture.current?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const controller = keyboardController.current;
    if (!controller) return;
    const rotationStep = MathUtils.degToRad(event.shiftKey ? 15 : 5);

    switch (event.key) {
      case 'ArrowLeft':
        controller.rotateHorizontal(rotationStep);
        setKeyboardStatus(keyboardMovedLabel);
        break;
      case 'ArrowRight':
        controller.rotateHorizontal(-rotationStep);
        setKeyboardStatus(keyboardMovedLabel);
        break;
      case 'ArrowUp':
        controller.rotateVertical(-rotationStep);
        setKeyboardStatus(keyboardMovedLabel);
        break;
      case 'ArrowDown':
        controller.rotateVertical(rotationStep);
        setKeyboardStatus(keyboardMovedLabel);
        break;
      case '+':
      case '=':
        controller.zoom(0.88);
        setKeyboardStatus(keyboardZoomedLabel);
        break;
      case '-':
      case '_':
        controller.zoom(1.14);
        setKeyboardStatus(keyboardZoomedLabel);
        break;
      case 'Enter':
        controller.selectCenter();
        setKeyboardStatus(keyboardSelectedLabel);
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  useEffect(() => {
    const canvas = viewport.current?.querySelector('canvas');
    if (!canvas) return;
    const lost = (event: Event) => {
      event.preventDefault();
      pointerStarts.clear();
      pointerActiveRef.current = false;
      setAntipodeDragActive(false);
      cancelCameraGesture.current?.();
      setContextLost(true);
    };
    const restored = () => {
      setContextLost(false);
      setVectorRenderSampleKey((value) => value + 1);
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [pointerStarts]);
  useEffect(() => {
    const pointers = pointerStarts;
    const clear = () => {
      pointers.clear();
      pointerActiveRef.current = false;
      setAntipodeDragActive(false);
      cancelCameraGesture.current?.();
    };
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('blur', clear);
      pointers.clear();
    };
  }, [pointerStarts]);
  useEffect(() => {
    resetViewportDiagnostics(viewport.current, showAntipodes);
  }, [diagnosticResetKey, showAntipodes]);

  const relationReady = Boolean(
    antipodeRelation?.origin.nearestMajorCity &&
    antipodeRelation.antipode.nearestMajorCity,
  );

  if (!supported) {
    return (
      <section className={styles.unavailable} role="status">
        <div className={styles.staticGlobe} />
        <p>{fallbackLabel}</p>
      </section>
    );
  }

  return (
    <div
      ref={viewport}
      className={styles.viewport}
      role="region"
      aria-label={ariaLabel}
      aria-describedby="globe-keyboard-instructions"
      data-quality={profile.level}
      data-vector-detail={profile.vectorDetail}
      data-vector-state={vectorState}
      data-vector-geometry-id={vectorGeometryId || undefined}
      data-vector-palette-version={
        vectorState === 'ready' ? vectorPaletteVersion : undefined
      }
      data-vector-raster-fallback-visible={String(vectorState !== 'ready')}
      data-vector-render-draws={vectorRenderEvidence?.vectorDraws}
      data-vector-renderer-calls={vectorRenderEvidence?.rendererCalls}
      data-vector-render-revision={vectorRenderEvidence?.revision}
      data-vector-drag-transparent={
        vectorState === 'ready' ? String(vectorDragTransparent) : undefined
      }
      data-vector-drag-effective-alpha={vectorDragEvidence || undefined}
      data-vector-drag-render-order={
        vectorState === 'ready' && antipodeDragVisible
          ? vectorDragOrderEvidence || undefined
          : undefined
      }
      data-vector-sunline-highlight={vectorSunlineHighlight ?? undefined}
      data-marker-role-count={
        showAntipodes ? (relationReady ? 4 : 2) : undefined
      }
      data-marker-roles={
        showAntipodes
          ? relationReady
            ? 'origin,antipode,origin-city,antipode-city'
            : 'origin,antipode'
          : undefined
      }
      data-antipode-relation-state={
        showAntipodes ? (relationReady ? 'ready' : 'pending') : undefined
      }
      data-antipode-city-shapes={
        showAntipodes && relationReady ? 'square,triangle' : undefined
      }
      data-marker-center-css-px={showAntipodes ? 3 : undefined}
      data-cross-section-interior-draw-count={showAntipodes ? 1 : undefined}
      data-antipode-drag-state={
        showAntipodes
          ? antipodeDragVisible
            ? 'active'
            : 'inactive'
          : undefined
      }
      data-antipode-inner-wall-visible={
        showAntipodes ? String(antipodeDragVisible) : undefined
      }
      data-antipode-center-glow-visible={
        showAntipodes ? String(antipodeDragVisible) : undefined
      }
      data-antipode-center-glow-flicker={
        showAntipodes && antipodeDragVisible
          ? 'pending'
          : showAntipodes
            ? 'off'
            : undefined
      }
      data-antipode-center-glow-revision={showAntipodes ? '0' : undefined}
      data-sunline-marker-geometry={sunline ? 'legacy-sphere-ring' : undefined}
      data-sunline-night-max-alpha={
        sunline ? SUNLINE_RENDERING.night.maxAlpha : undefined
      }
      data-sunline-layer-order={
        sunline ? 'mask,highlight,solar,selected-point' : undefined
      }
      data-sunline-selected-material={
        sunline
          ? materialDiagnostic(SUNLINE_RENDERING.selectedMarker)
          : undefined
      }
      data-sunline-solar-material={
        sunline ? materialDiagnostic(SUNLINE_RENDERING.solarMarker) : undefined
      }
      data-sunline-radius-order={
        sunline ? 'selected>solar>highlight>mask' : undefined
      }
      data-surname-map-label={
        selectedSurnameMapLabel
          ? `${selectedSurnameMapLabel.countryId}:${resolveSurnameWordmark(selectedSurnameMapLabel.record, surnameDisplayMode)?.value ?? ''}`
          : undefined
      }
      data-surname-map-label-country={
        selectedCountry?.name ?? selectedSurnameMapLabel?.countryName
      }
      data-surname-map-label-visible={
        selectedSurnameMapLabel ? String(surnameLabelVisible) : undefined
      }
      data-surname-map-label-count={
        surnameMapLabels.length > 0
          ? String(surnameMapLabels.length)
          : undefined
      }
      data-surname-map-label-entry-count={
        surnameMapLabels.length > 0
          ? String(surnameLabelLayout.entryCount)
          : undefined
      }
      data-surname-map-label-visible-count={
        surnameMapLabels.length > 0
          ? String(surnameLabelLayout.visibleCount)
          : undefined
      }
      data-surname-map-label-collision-count={
        surnameMapLabels.length > 0
          ? String(surnameLabelLayout.collisionCount)
          : undefined
      }
      data-surname-map-label-hidden-reason={
        selectedSurnameMapLabel
          ? (surnameLabelLayout.selectedHiddenReason ?? undefined)
          : undefined
      }
      data-surname-map-label-min-corner-radius={
        surnameMapLabels.length > 0
          ? String(surnameLabelLayout.minimumCornerRadius)
          : undefined
      }
      data-surname-map-label-visible-rectangles={
        surnameMapLabels.length > 0
          ? surnameLabelLayout.visibleRectangles
          : undefined
      }
      data-isolation-city-id={isolation?.cityId}
      data-isolation-view={isolation?.view}
      data-isolation-field-state={
        isolation?.view === 'field'
          ? vectorState === 'error'
            ? 'surface-error'
            : isolation.field.status
          : undefined
      }
      data-isolation-field-site-count={
        isolation?.view === 'field' ? isolation.field.sites.length : undefined
      }
      data-isolation-field-max-candidates={
        isolation?.field.table?.maxCandidates
      }
      data-isolation-field-rendered-alpha={
        isolation?.view === 'field' && isolation.field.status === 'ready'
          ? fieldRenderedAlpha?.toFixed(2)
          : undefined
      }
      data-isolation-competitor-id={isolation?.competitorId}
      data-isolation-radius-km={
        isolation?.radiusKm === null
          ? ''
          : isolation?.radiusKm === undefined
            ? undefined
            : String(Math.round(isolation.radiusKm))
      }
      data-isolation-alpha={isolation?.alpha.toFixed(2)}
      data-isolation-dot-count={
        isolation ? String(isolation.focalPoints.length) : undefined
      }
      data-isolation-arc={isolation?.arcStatus}
      data-sunline-selected-marker-role={
        sunline ? SUNLINE_RENDERING.selectedMarker.role : undefined
      }
      data-sunline-selected-marker-target={
        sunline
          ? `${formatDiagnosticCoordinate(point.latitude)},${formatDiagnosticCoordinate(point.longitude)}`
          : undefined
      }
      data-selected-country={sunline ? selectedCountry?.name : undefined}
      data-sunline-highlight-country={
        sunline ? selectedCountry?.name : undefined
      }
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDownCapture={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onWheel={() => {
        cancelCameraGesture.current?.();
        clearCameraDiagnostic(viewport.current);
        markMeaningfulInteraction();
        setCameraFocusFree();
      }}
    >
      <p id="globe-keyboard-instructions" className={styles.visuallyHidden}>
        {keyboardInstructions}
      </p>
      <Canvas
        dpr={profile.dpr}
        frameloop="demand"
        camera={{ position: [0, 0.15, 3.25], fov: 38, near: 0.1, far: 100 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        }}
      >
        <GlobeScene
          profile={profile}
          benchmarkActive={benchmark.active}
          recordBenchmarkFrame={benchmark.recordFrame}
          keyboardController={keyboardController}
          showAntipodes={showAntipodes}
          antipodeDragActive={antipodeDragVisible}
          dragDiagnosticsEnabled={dragDiagnosticsEnabled}
          sunline={sunline}
          antipodeRelation={antipodeRelation}
          surnameMapLabels={surnameMapLabels}
          surnameDisplayMode={surnameDisplayMode}
          isolation={isolation}
          onIsolationFieldRendered={setFieldRenderedAlpha}
          cameraGestureCancelRef={cancelCameraGesture}
          onSurnameLabelVisibilityChange={setSurnameLabelVisible}
          onSurnameLabelLayoutChange={setSurnameLabelLayout}
          diagnostics={diagnostics}
          onVectorStateChange={handleVectorStateChange}
          onVectorPaletteUpdate={setVectorPaletteVersion}
          onVectorDragMaterialChange={setVectorDragTransparent}
          onVectorSunlineHighlightChange={setVectorSunlineHighlight}
          onVectorDragEvidence={handleVectorDragEvidence}
          onVectorRenderEvidence={(vectorDraws, rendererCalls) =>
            setVectorRenderEvidence((current) => ({
              vectorDraws,
              rendererCalls,
              revision: (current?.revision ?? 0) + 1,
            }))
          }
          vectorRenderSampleKey={vectorRenderSampleKey}
          pointerActiveRef={pointerActiveRef}
        />
      </Canvas>
      {contextLost ? (
        <p className={styles.contextStatus} role="status">
          {contextLostLabel}
        </p>
      ) : null}
      {isolation?.view === 'field' && vectorState === 'error' ? (
        <p className={styles.contextStatus} role="status">
          {messages[locale].isolationFieldSurfaceError}
        </p>
      ) : null}
      {benchmark.enabled ? (
        <BenchmarkPanel phase={benchmark.phase} result={benchmark.result} />
      ) : null}
      <output className={styles.visuallyHidden} aria-live="polite">
        {keyboardStatus}
      </output>
    </div>
  );
}

function BenchmarkPanel({
  phase,
  result,
}: {
  phase: string;
  result: ReturnType<typeof useFrameBenchmark>['result'];
}) {
  return (
    <output className={styles.benchmark} data-phase={phase} aria-live="polite">
      <span>Render benchmark · {phase}</span>
      {result ? (
        <strong>
          {result.fps.toFixed(1)} fps · p95 {result.frameTimeP95Ms.toFixed(1)}{' '}
          ms · {result.quality}
        </strong>
      ) : (
        <strong>Collecting actual R3F frames…</strong>
      )}
    </output>
  );
}
