import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useIsolationField } from '../isolation/useIsolationField';
import { isolationFieldSelection } from '../isolation/isolationField';
import type { IsolationFieldState } from '../isolation/useIsolationField';
import type { ReshapedDataset } from '../reshaped/reshapedData';
import {
  RESHAPED_DEFAULT_METRIC,
  type ReshapedMetricId,
} from '../reshaped/metrics';

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
  field: IsolationFieldState;
  focalPoints: readonly GeoPoint[];
  city: GeoPoint;
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
      field: IsolationFieldState & { retry: () => void };
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
  const isolationData = useIsolationDataset(activeMode === 'isolation');
  const isolationAlpha = useAppStore((state) => state.isolationAlpha);
  const isolationView = useAppStore((state) => state.isolationView);
  const reshapedMetric = useAppStore(
    (state) => state.reshapedMetric ?? RESHAPED_DEFAULT_METRIC,
  );
  const localReshapedLoad = useReshapedDataset(
    activeMode === 'reshaped' && !sharedReshapedData,
    reshapedMetric,
  );
  const reshapedLoad = sharedReshapedData ?? localReshapedLoad;
  const selectedUnitId = useAppStore((state) => state.reshapedSelectedUnitId);
  const field = useIsolationField(
    isolationData.status === 'ready' ? isolationData.data : null,
    isolationAlpha,
    activeMode === 'isolation' && isolationView === 'field',
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
    return computeIsolationSelection(
      point,
      isolationAlpha,
      isolationData.data,
      isolationView === 'field'
        ? isolationFieldSelection(point, isolationData.data, field.sites)
        : null,
    );
  }, [
    activeMode,
    field.sites,
    isolationAlpha,
    isolationData,
    isolationView,
    point,
  ]);
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
        field,
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
      const selectedId = dataset?.ids
        ? (dataset.ids.ids[
            Math.min(
              dataset.ids.height - 1,
              Math.max(
                0,
                Math.floor(((90 - point.latitude) / 180) * dataset.ids.height),
              ),
            ) *
              dataset.ids.width +
              Math.floor(
                (((((point.longitude + 180) % 360) + 360) % 360) / 360) *
                  dataset.ids.width,
              )
          ] ?? 0)
        : 0;
      const unit =
        selectedUnitId !== undefined
          ? selectedUnitId === null
            ? null
            : (dataset?.unitsById.get(selectedUnitId) ?? null)
          : (dataset?.unitsByRasterId.get(selectedId) ??
            (!dataset?.ids && selectedCountry
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
  const isolationData = useIsolationDataset(activeMode === 'isolation');
  const isolationAlpha = useAppStore((state) => state.isolationAlpha);
  const isolationView = useAppStore((state) => state.isolationView);
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
  const field = useIsolationField(
    isolationData.status === 'ready' ? isolationData.data : null,
    isolationAlpha,
    activeMode === 'isolation' && isolationView === 'field',
  );

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
    if (activeMode !== 'isolation' || isolationData.status !== 'ready')
      return null;
    const dataset = isolationData.data;
    const selection = computeIsolationSelection(
      point,
      isolationAlpha,
      dataset,
      isolationView === 'field'
        ? isolationFieldSelection(point, dataset, field.sites)
        : null,
    );
    if (!selection) return null;
    const city = dataset.cities[selection.cityIndex];
    if (!city) return null;
    const competitor = selection.competitor;
    const competitorCity = competitor ? dataset.cities[competitor.index] : null;
    const arcStatus =
      isolationView === 'field'
        ? 'none'
        : !competitorCity
          ? 'none'
          : greatCircleArcPoints(city.point, competitorCity.point).length > 1
            ? 'drawn'
            : 'antipodal';
    return {
      alpha: isolationAlpha,
      view: isolationView,
      field,
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
          previous.current = data;
          setState({ status: 'ready', data });
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
  const matching = state.data?.metric === metric;
  return {
    ...(enabled
      ? state.status === 'ready' && !matching
        ? { status: 'loading' as const, data: state.data }
        : state
      : { status: 'idle' as const }),
    retry: () => setRetryKey((v) => v + 1),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled mode: ${String(value)}`);
}
