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
import {
  getDisplaySurnameRecord,
  type SurnameMapLabel,
} from '../surnames/surnameData';
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

export interface GlobePresentation {
  showAntipodes: boolean;
  sunline: SunlineRenderState | null;
  antipodeRelation: AntipodeRelation | null;
  surnameMapLabels: readonly SurnameMapLabel[];
  surnameDisplayMode: SurnameDisplayMode;
  isolation: IsolationGlobePresentation | null;
  reshaped: {
    metric: ReshapedMetricId;
    shape: 'true' | 'reshaped';
    data: ReshapedLoadState;
    replayKey: number;
  } | null;
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
    default:
      return assertNever(activeMode);
  }
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

  const sunline = useMemo(() => {
    if (activeMode !== 'sunline') return null;
    return { subsolarPoint: solarPosition(sunlineTimeMs).subsolarPoint };
  }, [activeMode, sunlineTimeMs]);

  const surnameMapLabels = useMemo(() => {
    if (activeMode !== 'surnames' || surnameData.status !== 'ready') {
      return [];
    }
    return surnameData.data.countries.flatMap((country) => {
      const record = getDisplaySurnameRecord(country);
      return record
        ? [
            {
              countryId: country.countryId,
              countryName: country.countryIso2,
              record,
            },
          ]
        : [];
    });
  }, [activeMode, surnameData]);

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

  return {
    showAntipodes: activeMode === 'antipodes',
    sunline,
    antipodeRelation,
    surnameMapLabels,
    surnameDisplayMode,
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
