import { useFrame, useThree } from '@react-three/fiber';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { Group, Texture } from 'three';
import {
  DataTexture,
  DoubleSide,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { geoToVector3 } from './geo';
import type { GeoPoint } from './geo';
import {
  computeVisibleSurnameSurfaceBounds,
  computeSurnameLabelLayout,
  type SurnameLabelObstacle,
  type SurnameLabelHiddenReason,
  type SurnameLabelScreenRect,
  type SurnameSurfaceProjectionPoint,
  type SurnameSurfaceTriangle,
} from './surnameLabelLayout';
import {
  createSphericalSurnameLabelGeometry,
  createSphericalSurnameLabelPoints,
  SURNAME_LABEL_SURFACE_LIFT,
} from './sphericalSurnameLabel';
import {
  createSurnameWordmarkSvg,
  getSurnameWordmarkHeightRatio,
  getSurnameWordmarkAngularFootprintDegrees,
  getSurnameWordmarkWorldWidth,
} from '../surnames/surnameWordmark';
import type { SurnameDisplayMode } from '../../state/urlState';
import { ignoreRaycast } from './sceneUtils';
import { type SurnameLabelEntry } from './surnameLabelLayout';

interface SurnameLayoutSample {
  key: string;
  positions: readonly [number, number, number][];
  points: SurnameSurfaceProjectionPoint[];
  triangles: SurnameSurfaceTriangle[];
}

interface SurnameTextureCacheEntry {
  texture: Texture;
  ready: Promise<Texture | null>;
}

type SurnameTextureCache = Map<string, SurnameTextureCacheEntry>;

function configureSurnameTexture(texture: Texture): Texture {
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function SurnameMapLabelLayer({
  entries,
  displayMode,
  selectedCountryId,
  cameraFocusTarget,
  onVisibilityChange,
  onLayoutChange,
  onSelectedLabelBlocked,
  cameraGestureActiveRef,
  pointerActiveRef,
  globeGroupRef,
}: {
  entries: readonly SurnameLabelEntry[];
  displayMode: SurnameDisplayMode;
  selectedCountryId: string | null;
  cameraFocusTarget: GeoPoint | null;
  onVisibilityChange: (visible: boolean) => void;
  onLayoutChange: (layout: {
    entryCount: number;
    visibleCount: number;
    collisionCount: number;
    selectedHiddenReason: SurnameLabelHiddenReason | null;
    minimumCornerRadius: number;
    visibleRectangles: string;
  }) => void;
  onSelectedLabelBlocked: (reason: SurnameLabelHiddenReason) => void;
  cameraGestureActiveRef: MutableRefObject<boolean>;
  pointerActiveRef: MutableRefObject<boolean>;
  globeGroupRef: MutableRefObject<Group | null>;
}) {
  const layoutSamples = useRef(new Map<string, SurnameLayoutSample>());
  const [textureCache] = useState<SurnameTextureCache>(() => new Map());
  const loadedLabelKey = useRef('');
  const loadableLabelIdsRef = useRef(new Set<string>());
  const preferredLabelIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [visibleLabelIds, setVisibleLabelIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [loadableLabelIds, setLoadableLabelIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const previousBlockedEvidence = useRef('');
  const previousStructuralEvidence = useRef('');
  const layoutDirty = useRef(true);
  const lastLayoutAt = useRef(Number.NEGATIVE_INFINITY);
  const deferredLayout = useRef<number | null>(null);
  const lastCameraMatrix = useRef<number[] | null>(null);
  const gestureWasActive = useRef(false);
  const { camera, gl, size, invalidate } = useThree();
  useEffect(
    () => () => {
      if (deferredLayout.current !== null) {
        window.clearTimeout(deferredLayout.current);
      }
    },
    [],
  );
  useEffect(
    () => () => {
      for (const entry of textureCache.values()) entry.texture.dispose();
      textureCache.clear();
    },
    [textureCache],
  );
  useEffect(() => {
    previousStructuralEvidence.current = '';
    previousBlockedEvidence.current = '';
    layoutDirty.current = true;
    invalidate();
  }, [
    cameraFocusTarget,
    entries,
    invalidate,
    selectedCountryId,
    size.height,
    size.width,
  ]);
  const worldPosition = useRef(new Vector3()).current;
  const projected = useRef(new Vector3()).current;
  const vertex = useRef(new Vector3()).current;
  const normal = useRef(new Vector3()).current;
  const toCamera = useRef(new Vector3()).current;
  const cameraPosition = useRef(new Vector3()).current;

  useFrame(() => {
    // OrbitControls owns the camera during a gesture. Keep the last accepted
    // label set until the gesture ends instead of projecting every curved
    // wordmark on every drag sample.
    const gestureActive =
      cameraGestureActiveRef.current || pointerActiveRef.current;
    if (gestureActive) {
      gestureWasActive.current = true;
      return;
    }
    if (gestureWasActive.current) {
      gestureWasActive.current = false;
      layoutDirty.current = true;
    }
    const now = performance.now();
    const cameraMatrix = camera.matrixWorld.elements;
    const previousCameraMatrix = lastCameraMatrix.current;
    let cameraChanged = previousCameraMatrix === null;
    if (!cameraChanged && previousCameraMatrix) {
      for (let index = 0; index < cameraMatrix.length; index += 1) {
        if (
          Math.abs(cameraMatrix[index]! - previousCameraMatrix[index]!) > 1e-7
        ) {
          cameraChanged = true;
          break;
        }
      }
    }
    if (!layoutDirty.current && !cameraChanged) return;
    // Focus animations can invalidate at display refresh rate. Twenty layout
    // passes per second keeps collision changes responsive while the camera is
    // moving; once it settles there is no reason to scan every country again.
    if (cameraChanged && now - lastLayoutAt.current < 50) {
      // With frameloop="demand" a throttled frame may be the last frame of a
      // camera move. Schedule one more frame so the settled view is laid out.
      if (deferredLayout.current === null) {
        deferredLayout.current = window.setTimeout(
          () => {
            deferredLayout.current = null;
            invalidate();
          },
          50 - (now - lastLayoutAt.current),
        );
      }
      return;
    }
    lastLayoutAt.current = now;
    layoutDirty.current = false;
    if (!previousCameraMatrix) {
      lastCameraMatrix.current = [...cameraMatrix];
    } else {
      for (let index = 0; index < cameraMatrix.length; index += 1) {
        previousCameraMatrix[index] = cameraMatrix[index]!;
      }
    }
    const globeMatrix = globeGroupRef.current?.matrixWorld;
    if (!globeMatrix) return;
    globeGroupRef.current?.updateMatrixWorld(true);
    cameraPosition.copy(camera.position);
    const canvasRect = gl.domElement.getBoundingClientRect();
    const obstacles: SurnameLabelObstacle[] = Array.from(
      document.querySelectorAll<HTMLElement>('[data-surname-label-obstacle]'),
    )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left - canvasRect.left,
          right: rect.right - canvasRect.left,
          top: rect.top - canvasRect.top,
          bottom: rect.bottom - canvasRect.top,
        };
      })
      .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
    const rectangles: SurnameLabelScreenRect[] = [];
    let minimumCornerRadius = Number.POSITIVE_INFINITY;

    for (const entry of entries) {
      const width = getSurnameWordmarkWorldWidth(
        entry.slot.maxAngularDegrees,
        entry.wordmark,
      );
      const sampleKey = `${entry.slot.center.latitude},${entry.slot.center.longitude}:${entry.slot.rotationDegrees}:${width}:${entry.wordmark.value}`;
      let sample = layoutSamples.current.get(entry.label.countryId);
      if (!sample || sample.key !== sampleKey) {
        const sourcePoints = createSphericalSurnameLabelPoints({
          center: entry.slot.center,
          angularRadiusDegrees: getSurnameWordmarkAngularFootprintDegrees(
            width,
            entry.wordmark,
          ),
          aspectRatio: getSurnameWordmarkHeightRatio(entry.wordmark),
          rotationDegrees: entry.slot.rotationDegrees,
          segmentsAlong: 2,
          segmentsAcross: 2,
        });
        const positions = sourcePoints.map(
          (point) => point.position,
        ) as readonly [number, number, number][];
        const points = positions.map(() => ({
          x: 0,
          y: 0,
          visibility: -1,
        }));
        const triangles: SurnameSurfaceTriangle[] = [];
        for (let row = 0; row < 2; row += 1) {
          for (let column = 0; column < 2; column += 1) {
            const lowerLeft = row * 3 + column;
            const lowerRight = lowerLeft + 1;
            const upperLeft = lowerLeft + 3;
            const upperRight = upperLeft + 1;
            triangles.push(
              { a: lowerLeft, b: lowerRight, c: upperLeft },
              { a: lowerRight, b: upperRight, c: upperLeft },
            );
          }
        }
        sample = { key: sampleKey, positions, points, triangles };
        layoutSamples.current.set(entry.label.countryId, sample);
      }
      const center = geoToVector3(
        entry.slot.center,
        SURNAME_LABEL_SURFACE_LIFT,
      ).applyMatrix4(globeMatrix);
      worldPosition.copy(center);
      const centerFrontFacing =
        normal
          .copy(worldPosition)
          .normalize()
          .dot(toCamera.subVectors(cameraPosition, worldPosition).normalize()) >
        0.12;
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      projected.copy(worldPosition).project(camera);
      const projectedCenterX = ((projected.x + 1) * size.width) / 2;
      const projectedCenterY = ((1 - projected.y) * size.height) / 2;
      for (let index = 0; index < sample.positions.length; index += 1) {
        const localPosition = sample.positions[index];
        const point = sample.points[index];
        if (!localPosition || !point) continue;
        vertex
          .set(localPosition[0], localPosition[1], localPosition[2])
          .applyMatrix4(globeMatrix);
        minimumCornerRadius = Math.min(minimumCornerRadius, vertex.length());
        projected.copy(vertex).project(camera);
        const x = ((projected.x + 1) * size.width) / 2;
        const y = ((1 - projected.y) * size.height) / 2;
        const visibility = normal
          .copy(vertex)
          .normalize()
          .dot(toCamera.subVectors(cameraPosition, vertex).normalize());
        point.x = x;
        point.y = y;
        point.visibility = visibility;
      }
      const visibleBounds = computeVisibleSurnameSurfaceBounds(
        sample.points,
        sample.triangles,
      );
      if (visibleBounds) {
        left = visibleBounds.left;
        right = visibleBounds.right;
        top = visibleBounds.top;
        bottom = visibleBounds.bottom;
      } else {
        // Keep finite bounds for the layout diagnostic; frontFacing is false,
        // so the pure layout function reports the stable backface reason.
        left = right = projectedCenterX;
        top = bottom = projectedCenterY;
      }
      rectangles.push({
        id: entry.label.countryId,
        left,
        right,
        top,
        bottom,
        // A curved label can remain readable after its center crosses the
        // silhouette. Use the projected surface sample ratio rather than a
        // single center-normal threshold so partial ocean overflow survives.
        frontFacing:
          Boolean(visibleBounds) &&
          ((visibleBounds?.frontPointCount ?? 0) /
            Math.max(1, sample.points.length) >=
            0.25 ||
            centerFrontFacing),
        selected: entry.label.countryId === selectedCountryId,
        countryArea: entry.slot.areaSteradians ?? 0,
        centerDistance: Math.hypot(
          projectedCenterX - size.width / 2,
          projectedCenterY - size.height / 2,
        ),
      });
    }

    const layout = computeSurnameLabelLayout(rectangles, obstacles, {
      width: size.width,
      height: size.height,
      preferredIds: preferredLabelIdsRef.current,
      // Every front-facing country keeps its wordmark. Country slots already
      // size the text against neighbouring land; projected screen overlap is
      // preferable to silently dropping a country's surname.
      allowCollisions: true,
    });
    preferredLabelIdsRef.current = layout.visibleIds;
    const nextLoadedLabelKey = [...layout.visibleIds].sort().join('|');
    if (loadedLabelKey.current !== nextLoadedLabelKey) {
      loadedLabelKey.current = nextLoadedLabelKey;
      let loadableChanged = false;
      for (const id of layout.visibleIds) {
        if (!loadableLabelIdsRef.current.has(id)) {
          loadableLabelIdsRef.current.add(id);
          loadableChanged = true;
        }
      }
      if (loadableChanged)
        setLoadableLabelIds(new Set(loadableLabelIdsRef.current));
      invalidate();
    }
    setVisibleLabelIds((current) =>
      setsEqual(current, layout.visibleIds)
        ? current
        : new Set(layout.visibleIds),
    );
    const selectedHiddenReason = selectedCountryId
      ? (layout.hiddenReasons.get(selectedCountryId) ?? null)
      : null;
    const visibleRectangles = JSON.stringify(
      rectangles
        .filter((rectangle) => layout.visibleIds.has(rectangle.id))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((rectangle) => ({
          id: rectangle.id,
          // Report the visible portion of an ocean-overflowing wordmark.
          // Collision/layout still uses the full surface envelope, while
          // diagnostics describe what is actually inside the canvas.
          left: Math.round(Math.max(0, rectangle.left)),
          right: Math.round(Math.min(size.width, rectangle.right)),
          top: Math.round(Math.max(0, rectangle.top)),
          bottom: Math.round(Math.min(size.height, rectangle.bottom)),
        })),
    );
    const roundedMinimumCornerRadius = Number(minimumCornerRadius.toFixed(6));
    const focusEvidence = cameraFocusTarget
      ? `${cameraFocusTarget.latitude},${cameraFocusTarget.longitude}`
      : 'settled';
    const structuralEvidence = `${entries.length}:${layout.visibleCount}:${layout.collisionCount}:${layout.selectedVisible}:${selectedHiddenReason ?? ''}`;
    const structuralChanged =
      previousStructuralEvidence.current !== structuralEvidence;
    if (structuralChanged) {
      previousStructuralEvidence.current = structuralEvidence;
      onVisibilityChange(layout.selectedVisible);
      onLayoutChange({
        entryCount: entries.length,
        visibleCount: layout.visibleCount,
        collisionCount: layout.collisionCount,
        selectedHiddenReason,
        minimumCornerRadius: roundedMinimumCornerRadius,
        visibleRectangles,
      });
    }
    const selectedSlot = entries.find(
      (entry) => entry.label.countryId === selectedCountryId,
    )?.slot;
    const slotEvidence = selectedSlot
      ? `${selectedSlot.center.latitude},${selectedSlot.center.longitude},${selectedSlot.maxAngularDegrees}`
      : '';
    const blockedEvidence = `${selectedCountryId ?? ''}:${selectedHiddenReason ?? ''}:${focusEvidence}:${slotEvidence}`;
    if (
      selectedHiddenReason &&
      previousBlockedEvidence.current !== blockedEvidence
    ) {
      previousBlockedEvidence.current = blockedEvidence;
      if (!cameraFocusTarget) onSelectedLabelBlocked(selectedHiddenReason);
    } else if (!selectedHiddenReason) {
      previousBlockedEvidence.current = '';
    }
  });

  return (
    <>
      {entries
        .filter((entry) => visibleLabelIds.has(entry.label.countryId))
        .map((entry) => (
          <SurnameMapLabelSurface
            key={`${entry.label.countryId}:${displayMode}`}
            entry={entry}
            loadTexture={loadableLabelIds.has(entry.label.countryId)}
            textureCache={textureCache}
            invalidate={invalidate}
          />
        ))}
    </>
  );
}

function SurnameMapLabelSurface({
  entry,
  loadTexture,
  textureCache,
  invalidate,
}: {
  entry: SurnameLabelEntry;
  loadTexture: boolean;
  textureCache: SurnameTextureCache;
  invalidate: () => void;
}) {
  const wordmark = entry.wordmark;
  const cacheKey = `${entry.label.countryId}:${wordmark.requestedMode}:${wordmark.value}`;
  const placeholder = useMemo(() => {
    const placeholder = new DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
      RGBAFormat,
    );
    placeholder.needsUpdate = true;
    return placeholder;
  }, []);
  const [texture, setTexture] = useState<import('three').Texture>(
    () => textureCache.get(cacheKey)?.texture ?? placeholder,
  );
  useEffect(() => {
    if (!wordmark || !loadTexture) return;
    let textureEntry = textureCache.get(cacheKey);
    if (!textureEntry) {
      const loader = new TextureLoader();
      const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(createSurnameWordmarkSvg(wordmark))}`;
      let resolveReady: (texture: Texture | null) => void = () => undefined;
      const ready = new Promise<Texture | null>((resolve) => {
        resolveReady = resolve;
      });
      const loaded = loader.load(
        dataUri,
        (nextTexture) => {
          configureSurnameTexture(nextTexture);
          resolveReady(nextTexture);
        },
        undefined,
        () => {
          textureCache.delete(cacheKey);
          resolveReady(null);
        },
      );
      textureEntry = { texture: configureSurnameTexture(loaded), ready };
      textureCache.set(cacheKey, textureEntry);
    }
    const cachedTexture = textureEntry.texture;
    configureSurnameTexture(cachedTexture);
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setTexture(cachedTexture);
    });
    textureEntry.ready.then((readyTexture) => {
      if (readyTexture) configureSurnameTexture(readyTexture);
      invalidate();
      if (disposed || !readyTexture) return;
      setTexture(readyTexture);
    });
    return () => {
      disposed = true;
    };
  }, [cacheKey, invalidate, loadTexture, textureCache, wordmark]);
  const width = getSurnameWordmarkWorldWidth(
    entry.slot.maxAngularDegrees,
    wordmark,
  );
  const geometry = useMemo(
    () =>
      createSphericalSurnameLabelGeometry({
        center: entry.slot.center,
        angularRadiusDegrees: getSurnameWordmarkAngularFootprintDegrees(
          width,
          wordmark,
        ),
        aspectRatio: getSurnameWordmarkHeightRatio(wordmark),
        rotationDegrees: entry.slot.rotationDegrees,
      }),
    [entry.slot.center, entry.slot.rotationDegrees, width, wordmark],
  );

  useEffect(() => () => placeholder.dispose(), [placeholder]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  if (!wordmark) return null;

  const materialTexture = loadTexture ? texture : placeholder;

  return (
    <mesh geometry={geometry} renderOrder={6} raycast={ignoreRaycast}>
      <meshBasicMaterial
        map={materialTexture}
        transparent
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  );
}

function setsEqual(
  first: ReadonlySet<string>,
  second: ReadonlySet<string>,
): boolean {
  if (first.size !== second.size) return false;
  for (const value of first) if (!second.has(value)) return false;
  return true;
}
