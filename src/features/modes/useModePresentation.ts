import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import type { GeoPoint } from '../globe/geo';
import type { CountryRef } from '../globe/countryData';
import {
  createAntipodeRelation,
  type AntipodeRelation,
} from '../antipodes/relation';
import { observeSun, solarEventsUtc, solarPosition } from '../sunline/solar';
import type { SunlineRenderState } from '../globe/GlobeScene';
import {
  useGeoNamesCityIndex,
  type GeoNamesCityLoadState,
} from '../antipodes/useGeoNamesCityIndex';
import {
  useSurnameDataset,
  type SurnameLoadState,
} from '../surnames/useSurnameDataset';
import { getDisplaySurnameRecord } from '../surnames/surnameData';
import { resolveSurnameWordmark } from '../surnames/surnameWordmark';
import type { MapWordmarkLabel } from '../globe/mapWordmark';
import { COUNTRY_NAMES } from '../globe/countryNames';
import {
  useLiteralNames,
  type LiteralNamesLoadState,
} from '../names/useLiteralNames';
import {
  DEFAULT_LITERAL_NAME_LABEL,
  resolveLiteralNameWordmark,
  type LiteralNameLabel,
} from '../names/literalNameWordmark';
import type { SurnameDisplayMode } from '../../state/urlState';
import { DEFAULT_SURNAME_DISPLAY_MODE } from '../../state/urlState';
import {
  useIsolationDataset,
  type IsolationLoadState,
} from '../isolation/useIsolationDataset';
import {
  computeIsolationSelection,
  type IsolationDataset,
} from '../isolation/isolationData';
import type { RecordHolder } from '../isolation/isolationMetric';
import { greatCircleArcPoints } from '../isolation/isolationGeometry';
import type { IsolationView } from '../../state/urlState';
import type {
  ReshapedDataset,
  ReshapedPatchAtlas,
} from '../reshaped/reshapedData';
import { sampleReshapedLabel } from '../reshaped/labelSampling.mjs';
import { sampleReshapedPatchLabel } from '../reshaped/patchSampling.mjs';
import {
  RESHAPED_DEFAULT_METRIC,
  type ReshapedMetricId,
} from '../reshaped/metrics';
import {
  useCityReachField,
  type CityReachFieldState,
} from '../isolation/useCityReachField';
import { cityReachPointSelection } from '../isolation/cityReachData';
import type { CityReachPointSelection } from '../isolation/cityReachTypes';
import type { CityReachLevel } from '../isolation/cityReachLevel';
import {
  TRUE_SIZE_DEFAULT_COUNTRY,
  placeTrueSizeCountry,
  type TrueSizePlacement,
} from '../truesize/trueSize';
import {
  useLandBorders,
  type LandBordersLoadState,
} from '../borders/useLandBorders';
import {
  findRoute,
  summarizeReach,
  type ReachSummary,
  type RouteResult,
} from '../borders/landBorders';
import { bordersCountryColors } from '../borders/bordersPalette';
import {
  useCircleDataset,
  type CircleLoadState,
} from '../circle/useCircleDataset';
import {
  circleProfileAt,
  selectionFromProfile,
  type CircleSelection,
} from '../circle/circleSelection';
import { radiusForShare } from '../circle/circleProfile.mjs';
import {
  useClimateDataset,
  type ClimateLoadState,
} from '../climate/useClimateDataset';
import {
  findClimateTwins,
  sampleClimate,
  type ClimateDataset,
  type ClimateTwins,
} from '../climate/climateMetrics';

export interface GlobePresentation {
  showAntipodes: boolean;
  sunline: SunlineRenderState | null;
  antipodeRelation: AntipodeRelation | null;
  mapWordmarks: readonly MapWordmarkLabel[];
  /** Identifies the wordmark text source, so the label layer can reset. */
  wordmarkKey: string;
  isolation: IsolationGlobePresentation | null;
  reshaped: {
    metric: ReshapedMetricId;
    shape: 'true' | 'reshaped';
    data: ReshapedLoadState;
    replayKey: number;
  } | null;
  /** Per-unit land colours; `null` keeps the base land colour. */
  countryColors: ReadonlyMap<string, string> | null;
  circle: CircleGlobePresentation | null;
  climate: ClimateGlobePresentation | null;
}

export interface CircleGlobePresentation {
  centre: GeoPoint;
  radiusKm: number | null;
  displayDensity: Uint8Array | null;
  gridWidth: number;
  gridHeight: number;
}

export interface ClimateGlobePresentation {
  dataset: ClimateDataset | null;
  selectedValue: number | null;
  latitude: number;
}

export interface IsolationGlobePresentation {
  alpha: number;
  view: IsolationView;
  field: CityReachFieldState;
  fieldSelection: CityReachPointSelection | null;
  focalPoints: readonly GeoPoint[];
  city: GeoPoint | null;
  competitor: GeoPoint | null;
  radiusKm: number | null;
  cityId: string;
  competitorId: string;
  arcStatus: 'drawn' | 'none' | 'antipodal';
}

export interface ReshapedLoadState {
  status: 'idle' | 'loading' | 'error' | 'ready';
  data?: ReshapedDataset;
  retry: () => void;
  onPatchesReady?: (atlas: ReshapedPatchAtlas) => void;
}

export type AntipodeRelationLoadState = 'idle' | 'loading' | 'error' | 'ready';

export type ModePresentation =
  | {
      id: 'antipodes';
      selectedCountry: CountryRef | null;
      antipodeCountry: CountryRef | null;
      relation: AntipodeRelation;
      relationStatus: AntipodeRelationLoadState;
      cityIndex: GeoNamesCityLoadState;
    }
  | {
      id: 'sunline';
      point: GeoPoint;
      selectedCountry: CountryRef | null;
      sun: {
        position: ReturnType<typeof solarPosition>;
        observation: ReturnType<typeof observeSun>;
        events: ReturnType<typeof solarEventsUtc>;
      };
    }
  | {
      id: 'surnames';
      surnameDisplayMode: SurnameDisplayMode;
      selectedCountry: CountryRef | null;
      surnameData: SurnameLoadState;
    }
  | {
      id: 'isolation';
      alpha: number;
      view: IsolationView;
      reach: CityReachLevel;
      field: CityReachFieldState;
      fieldSelection: CityReachPointSelection | null;
      dataset: IsolationLoadState;
      selection: {
        cityIndex: number;
        distanceFromPointKm: number;
        competitor: RecordHolder | null;
        rank: { position: number; total: number } | null;
      } | null;
      ranking: readonly {
        city: IsolationDataset['cities'][number];
        distanceKm: number;
      }[];
    }
  | {
      id: 'reshaped';
      metric: ReshapedMetricId;
      point: GeoPoint;
      selectedCountry: CountryRef | null;
      data: ReshapedLoadState;
      selectedUnit: import('../reshaped/reshapedData').ReshapedUnit | null;
      selectedValue: import('../reshaped/reshapedData').ReshapedValueRow | null;
      ranking: readonly import('../reshaped/reshapedData').ReshapedValueRow[];
    }
  | {
      id: 'truesize';
      point: GeoPoint;
      selectedCountry: CountryRef | null;
      placement: TrueSizePlacement | null;
    }
  | {
      id: 'borders';
      selectedCountry: CountryRef | null;
      destination: string | null;
      data: LandBordersLoadState;
      reach: ReachSummary | null;
      route: RouteResult | null;
    }
  | {
      id: 'circle';
      point: GeoPoint;
      selectedCountry: CountryRef | null;
      radiusKm: number | null;
      data: CircleLoadState;
      selection: CircleSelection | null;
    }
  | {
      id: 'names';
      selectedCountry: CountryRef | null;
      label: LiteralNameLabel;
      data: LiteralNamesLoadState;
    }
  | {
      id: 'climate';
      point: GeoPoint;
      selectedCountry: CountryRef | null;
      data: ClimateLoadState;
      cities: GeoNamesCityLoadState;
      twins: ClimateTwins | null;
    };

/**
 * Returns the active-mode presentation, or `null` when the shell is in the
 * neutral lobby. Inactive-mode resources stay idle and inactive-mode
 * computations are skipped.
 */
export function useModePresentation(
  sharedReshapedData?: ReshapedLoadState,
): ModePresentation | null {
  const activeMode = useAppStore((state) => state.activeMode);
  const point = useAppStore((state) => state.point);
  const selectedCountry = useAppStore((state) => state.selectedCountry);
  const antipodeCountry = useAppStore((state) => state.antipodeCountry);
  const sunlineTimeMs = useAppStore((state) => state.sunlineTimeMs);
  const surnameDisplayMode =
    useAppStore((state) => state.surnameDisplayMode) ??
    DEFAULT_SURNAME_DISPLAY_MODE;
  const cityIndex = useGeoNamesCityIndex(activeMode === 'antipodes');
  const surnameData = useSurnameDataset(activeMode === 'surnames');
  const literalNames = useLiteralNames(activeMode === 'names');
  const namesLabel =
    useAppStore((state) => state.namesLabel) ?? DEFAULT_LITERAL_NAME_LABEL;
  const isolationView = useAppStore((state) => state.isolationView);
  const isolationData = useIsolationDataset(
    activeMode === 'isolation' && isolationView === 'city',
  );
  const isolationAlpha = useAppStore((state) => state.isolationAlpha);
  const isolationReach = useAppStore((state) => state.isolationReach);
  const field = useCityReachField(
    isolationReach,
    activeMode === 'isolation' && isolationView === 'field',
  );
  const reshapedMetric = useAppStore(
    (state) => state.reshapedMetric ?? RESHAPED_DEFAULT_METRIC,
  );
  const localReshapedLoad = useReshapedDataset(
    activeMode === 'reshaped' && !sharedReshapedData,
    reshapedMetric,
  );
  const reshapedLoad = sharedReshapedData ?? localReshapedLoad;
  const selectedUnitId = useAppStore((state) => state.reshapedSelectedUnitId);
  const bordersDestination = useAppStore((state) => state.bordersDestination);
  const landBorders = useLandBorders(activeMode === 'borders');
  const borders = useBordersAnalysis(
    activeMode === 'borders',
    landBorders,
    selectedCountry?.countryId ?? null,
    bordersDestination,
  );
  const circleRadiusKm = useAppStore((state) => state.circleRadiusKm);
  const circleData = useCircleDataset(activeMode === 'circle');
  // The profile depends only on the place; slider ticks reuse it.
  const circleProfile = useMemo(
    () =>
      activeMode === 'circle' && circleData.status === 'ready'
        ? circleProfileAt(circleData.data, point)
        : null,
    [activeMode, circleData, point],
  );
  const circleSelection = useMemo(
    () =>
      circleProfile && circleData.status === 'ready'
        ? selectionFromProfile(circleData.data, circleProfile, circleRadiusKm)
        : null,
    [circleData, circleProfile, circleRadiusKm],
  );
  const climateData = useClimateDataset(activeMode === 'climate');
  const climateCities = useGeoNamesCityIndex(activeMode === 'climate');
  const climateTwins = useMemo(
    () =>
      activeMode === 'climate' && climateData.status === 'ready'
        ? findClimateTwins(
            climateData.data,
            climateCities.status === 'ready' ? climateCities.data : [],
            point,
          )
        : null,
    [activeMode, climateCities, climateData, point],
  );

  const relation = useMemo(
    () =>
      activeMode === 'antipodes'
        ? createAntipodeRelation(
            point,
            cityIndex.status === 'ready' ? cityIndex.data : undefined,
          )
        : null,
    [activeMode, cityIndex, point],
  );
  const sun = useMemo(() => {
    if (activeMode !== 'sunline') return null;
    const position = solarPosition(sunlineTimeMs);
    return {
      position,
      observation: observeSun(point, sunlineTimeMs),
      events: solarEventsUtc(point, sunlineTimeMs),
    };
  }, [activeMode, point, sunlineTimeMs]);
  const isolation = useMemo(() => {
    if (activeMode !== 'isolation' || isolationData.status !== 'ready')
      return null;
    return computeIsolationSelection(point, isolationAlpha, isolationData.data);
  }, [activeMode, isolationAlpha, isolationData, point]);
  const trueSizeCountry = useAppStore(
    (state) => state.trueSizeCountry ?? TRUE_SIZE_DEFAULT_COUNTRY,
  );
  const trueSizePlacement = useMemo(
    () =>
      activeMode === 'truesize'
        ? placeTrueSizeCountry(trueSizeCountry, point)
        : null,
    [activeMode, point, trueSizeCountry],
  );
  const fieldSelection = useMemo(
    () =>
      field.metadata && field.frame
        ? cityReachPointSelection(point, field.metadata, field.frame)
        : null,
    [point, field.metadata, field.frame],
  );
  switch (activeMode) {
    case null:
      return null;
    case 'antipodes':
      return {
        id: activeMode,
        selectedCountry,
        antipodeCountry,
        // activeMode === 'antipodes' guarantees a non-null relation.
        relation: relation!,
        relationStatus: cityIndex.status,
        cityIndex,
      };
    case 'sunline':
      return {
        id: activeMode,
        point,
        selectedCountry,
        // activeMode === 'sunline' guarantees a non-null sun.
        sun: sun!,
      };
    case 'surnames':
      return {
        id: activeMode,
        selectedCountry,
        surnameData,
        surnameDisplayMode,
      };
    case 'isolation':
      return {
        id: activeMode,
        alpha: isolationAlpha,
        view: isolationView,
        reach: isolationReach,
        field,
        fieldSelection,
        dataset: isolationData,
        selection: isolation
          ? {
              cityIndex: isolation.cityIndex,
              distanceFromPointKm: isolation.distanceFromPointKm,
              competitor: isolation.competitor,
              rank: isolation.rank,
            }
          : null,
        ranking: isolation?.ranking ?? [],
      };
    case 'reshaped': {
      const dataset = reshapedLoad.data;
      const selectedId =
        sampleReshapedPatchLabel(
          dataset?.patchAtlas ?? null,
          point.latitude,
          point.longitude,
        )?.id ??
        sampleReshapedLabel(
          dataset?.ids ?? null,
          point.latitude,
          point.longitude,
        ).id;
      const rasterUnit = dataset?.unitsByRasterId.get(selectedId);
      const unit =
        selectedUnitId !== undefined
          ? selectedUnitId === null
            ? null
            : (dataset?.unitsById.get(selectedUnitId) ?? null)
          : (rasterUnit ??
            (selectedCountry
              ? dataset?.unitsById.get(selectedCountry.countryId)
              : null) ??
            null);
      const selectedValue = unit
        ? (dataset?.values.get(unit.id) ?? null)
        : null;
      const ranking = dataset
        ? [...dataset.values.values()]
            .sort(
              (a, b) =>
                (b.worldShare[reshapedMetric] ?? 0) -
                (a.worldShare[reshapedMetric] ?? 0),
            )
            .filter((row) => row.worldShare[reshapedMetric] !== null)
            .slice(0, 10)
        : [];
      if (selectedValue && !ranking.some((row) => row.id === selectedValue.id))
        ranking.push(selectedValue);
      return {
        id: activeMode,
        metric: reshapedMetric,
        point,
        selectedCountry,
        data: reshapedLoad,
        selectedUnit: unit,
        selectedValue,
        ranking,
      };
    }
    case 'truesize':
      return {
        id: activeMode,
        point,
        selectedCountry,
        placement: trueSizePlacement,
      };
    case 'borders':
      return {
        id: activeMode,
        selectedCountry,
        destination: bordersDestination,
        data: landBorders,
        reach: borders.reach,
        route: borders.route,
      };
    case 'circle':
      return {
        id: activeMode,
        point,
        selectedCountry,
        radiusKm: circleRadiusKm,
        data: circleData,
        selection: circleSelection,
      };
    case 'names':
      return {
        id: activeMode,
        selectedCountry,
        label: namesLabel,
        data: literalNames,
      };
    case 'climate':
      return {
        id: activeMode,
        point,
        selectedCountry,
        data: climateData,
        cities: climateCities,
        twins: climateTwins,
      };
    default:
      return assertNever(activeMode);
  }
}

function useBordersAnalysis(
  enabled: boolean,
  data: LandBordersLoadState,
  startId: string | null,
  destination: string | null,
): { reach: ReachSummary | null; route: RouteResult | null } {
  return useMemo(() => {
    if (!enabled || data.status !== 'ready' || !startId) {
      return { reach: null, route: null };
    }
    return {
      reach: summarizeReach(data.data, startId),
      route: destination ? findRoute(data.data, startId, destination) : null,
    };
  }, [data, destination, enabled, startId]);
}

/** Globe-only presentation; isolation uses the same selection as the card. */
export function useGlobePresentation(
  sharedReshapedData?: ReshapedLoadState,
): GlobePresentation {
  const activeMode = useAppStore((state) => state.activeMode);
  const point = useAppStore((state) => state.point);
  const sunlineTimeMs = useAppStore((state) => state.sunlineTimeMs);
  const cityIndex = useGeoNamesCityIndex(activeMode === 'antipodes');
  const surnameData = useSurnameDataset(activeMode === 'surnames');
  const surnameDisplayMode =
    useAppStore((state) => state.surnameDisplayMode) ??
    DEFAULT_SURNAME_DISPLAY_MODE;
  const literalNames = useLiteralNames(activeMode === 'names');
  const namesLabel =
    useAppStore((state) => state.namesLabel) ?? DEFAULT_LITERAL_NAME_LABEL;
  const locale = useAppStore((state) => state.locale);
  const isolationView = useAppStore((state) => state.isolationView);
  const isolationData = useIsolationDataset(
    activeMode === 'isolation' && isolationView === 'city',
  );
  const isolationAlpha = useAppStore((state) => state.isolationAlpha);
  const isolationReach = useAppStore((state) => state.isolationReach);
  const field = useCityReachField(
    isolationReach,
    activeMode === 'isolation' && isolationView === 'field',
  );
  const reshapedMetric = useAppStore(
    (state) => state.reshapedMetric ?? RESHAPED_DEFAULT_METRIC,
  );
  const reshapedShape = useAppStore(
    (state) => state.reshapedShape ?? 'reshaped',
  );
  const reshapedReplayKey = useAppStore((state) => state.reshapedReplayKey);
  const localReshapedData = useReshapedDataset(
    activeMode === 'reshaped' && !sharedReshapedData,
    reshapedMetric,
  );
  const reshapedData = sharedReshapedData ?? localReshapedData;
  const selectedCountry = useAppStore((state) => state.selectedCountry);
  const bordersDestination = useAppStore((state) => state.bordersDestination);
  const landBorders = useLandBorders(activeMode === 'borders');
  const borders = useBordersAnalysis(
    activeMode === 'borders',
    landBorders,
    selectedCountry?.countryId ?? null,
    bordersDestination,
  );
  const countryColors = useMemo(
    () =>
      activeMode === 'borders'
        ? bordersCountryColors(borders.reach, borders.route)
        : null,
    [activeMode, borders],
  );
  const circleRadiusKm = useAppStore((state) => state.circleRadiusKm);
  const circleData = useCircleDataset(activeMode === 'circle');
  // A chosen radius is drawn as is; only the default half circle needs the
  // population profile, which changes with the place, not the slider.
  const circleHalfRadiusKm = useMemo(
    () =>
      activeMode === 'circle' && circleData.status === 'ready'
        ? radiusForShare(circleProfileAt(circleData.data, point), 0.5)
        : null,
    [activeMode, circleData, point],
  );
  const circle = useMemo<CircleGlobePresentation | null>(() => {
    if (activeMode !== 'circle') return null;
    const dataset = circleData.status === 'ready' ? circleData.data : null;
    return {
      centre: point,
      radiusKm: dataset ? (circleRadiusKm ?? circleHalfRadiusKm) : null,
      displayDensity: dataset?.displayDensity ?? null,
      gridWidth: dataset?.width ?? 0,
      gridHeight: dataset?.height ?? 0,
    };
  }, [activeMode, circleData, circleHalfRadiusKm, circleRadiusKm, point]);
  const climateData = useClimateDataset(activeMode === 'climate');

  const sunline = useMemo(() => {
    if (activeMode !== 'sunline') return null;
    return { subsolarPoint: solarPosition(sunlineTimeMs).subsolarPoint };
  }, [activeMode, sunlineTimeMs]);

  const mapWordmarks = useMemo<readonly MapWordmarkLabel[]>(() => {
    if (activeMode === 'surnames' && surnameData.status === 'ready') {
      return surnameData.data.countries.flatMap((country) => {
        const record = getDisplaySurnameRecord(country);
        return record
          ? [
              {
                countryId: country.countryId,
                countryName: country.countryIso2,
                wordmark: resolveSurnameWordmark(record, surnameDisplayMode),
              },
            ]
          : [];
      });
    }
    if (activeMode === 'names' && literalNames.status === 'ready') {
      return literalNames.data.records.map((record) => ({
        countryId: record.id,
        countryName: COUNTRY_NAMES[record.id]?.en ?? record.id,
        wordmark: resolveLiteralNameWordmark(record, namesLabel, locale),
      }));
    }
    return [];
  }, [
    activeMode,
    literalNames,
    locale,
    namesLabel,
    surnameData,
    surnameDisplayMode,
  ]);
  const wordmarkKey =
    activeMode === 'surnames'
      ? `surnames:${surnameDisplayMode}`
      : activeMode === 'names'
        ? `names:${namesLabel}:${locale}`
        : '';

  const antipodeRelation = useMemo(() => {
    if (activeMode !== 'antipodes') return null;
    return createAntipodeRelation(
      point,
      cityIndex.status === 'ready' ? cityIndex.data : undefined,
    );
  }, [activeMode, cityIndex, point]);

  const focalPoints = useMemo(
    () =>
      isolationData.data?.focalIndices.map(
        (index) => isolationData.data!.cities[index]!.point,
      ) ?? [],
    [isolationData.data],
  );
  const isolation = useMemo<IsolationGlobePresentation | null>(() => {
    if (activeMode !== 'isolation') return null;
    if (isolationView === 'field') {
      const fieldSelection =
        field.metadata && field.frame
          ? cityReachPointSelection(point, field.metadata, field.frame)
          : null;
      const city =
        fieldSelection?.status === 'owned' ? fieldSelection.city : null;
      return {
        alpha: isolationAlpha,
        view: isolationView,
        field,
        fieldSelection,
        focalPoints:
          field.metadata?.cities
            .filter((candidate) =>
              field.frame?.ownerIds.has(candidate.ownerIndex),
            )
            .map((candidate) => candidate.centrePoint ?? candidate.point) ?? [],
        city: city?.centrePoint ?? city?.point ?? null,
        competitor: null,
        radiusKm: null,
        cityId: city ? String(city.id) : '',
        competitorId: '',
        arcStatus: 'none',
      };
    }
    if (isolationData.status !== 'ready') return null;
    const dataset = isolationData.data;
    const selection = computeIsolationSelection(point, isolationAlpha, dataset);
    if (!selection) return null;
    const city = dataset.cities[selection.cityIndex];
    if (!city) return null;
    const competitor = selection.competitor;
    const competitorCity = competitor ? dataset.cities[competitor.index] : null;
    const arcStatus = !competitorCity
      ? 'none'
      : greatCircleArcPoints(city.point, competitorCity.point).length > 1
        ? 'drawn'
        : 'antipodal';
    return {
      alpha: isolationAlpha,
      view: isolationView,
      field,
      fieldSelection: null,
      focalPoints,
      city: city.point,
      competitor: competitor ? competitorCity!.point : null,
      radiusKm: competitor?.distanceKm ?? null,
      cityId: city.id,
      competitorId: competitorCity?.id ?? '',
      arcStatus,
    };
  }, [
    activeMode,
    field,
    focalPoints,
    isolationAlpha,
    isolationData,
    isolationView,
    point,
  ]);

  const climate = useMemo<ClimateGlobePresentation | null>(() => {
    if (activeMode !== 'climate') return null;
    const dataset = climateData.status === 'ready' ? climateData.data : null;
    return {
      dataset,
      selectedValue: dataset
        ? (sampleClimate(dataset, point)?.value ?? null)
        : null,
      latitude: point.latitude,
    };
  }, [activeMode, climateData, point]);

  return {
    showAntipodes: activeMode === 'antipodes',
    sunline,
    antipodeRelation,
    mapWordmarks,
    wordmarkKey,
    isolation,
    reshaped:
      activeMode === 'reshaped'
        ? {
            metric: reshapedMetric,
            shape: reshapedShape,
            data: reshapedData,
            replayKey: reshapedReplayKey,
          }
        : null,
    countryColors,
    circle,
    climate,
  };
}

/** Share only the asynchronous resource between globe and result; mode
 * calculations remain inside their existing failure boundary. */
export function useSharedReshapedData(): ReshapedLoadState {
  const activeMode = useAppStore((state) => state.activeMode);
  const metric = useAppStore(
    (state) => state.reshapedMetric ?? RESHAPED_DEFAULT_METRIC,
  );
  return useReshapedDataset(activeMode === 'reshaped', metric);
}

function useReshapedDataset(
  enabled: boolean,
  metric: ReshapedMetricId,
): ReshapedLoadState {
  const [state, setState] = useState<Omit<ReshapedLoadState, 'retry'>>({
    status: 'idle',
  });
  const [retryKey, setRetryKey] = useState(0);
  const previous = useRef<ReshapedDataset | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    if (!enabled) {
      previous.current = undefined;
      void Promise.resolve().then(() => {
        if (!controller.signal.aborted) setState({ status: 'idle' });
      });
      return () => controller.abort();
    }
    void import('../reshaped/reshapedData')
      .then(({ loadReshapedData }) => {
        if (controller.signal.aborted) return;
        setState({ status: 'loading', data: previous.current });
        return loadReshapedData(
          metric,
          controller.signal,
          previous.current,
        ).then((data) => {
          if (controller.signal.aborted) return;
          const readyData = {
            ...data,
            patchAtlas: previous.current?.patchAtlas ?? data.patchAtlas,
          };
          previous.current = readyData;
          setState({ status: 'ready', data: readyData });
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          previous.current = undefined;
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [enabled, metric, retryKey]);
  const onPatchesReady = useCallback(
    (atlas: ReshapedPatchAtlas) => {
      if (!enabled || !previous.current) return;
      previous.current = { ...previous.current, patchAtlas: atlas };
      setState((current) =>
        current.data
          ? { ...current, data: { ...current.data, patchAtlas: atlas } }
          : current,
      );
    },
    [enabled],
  );
  const matching = state.data?.metric === metric;
  return {
    ...(enabled
      ? state.status === 'ready' && !matching
        ? { status: 'loading' as const, data: state.data }
        : state
      : { status: 'idle' as const }),
    retry: () => setRetryKey((v) => v + 1),
    onPatchesReady,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled mode: ${String(value)}`);
}
