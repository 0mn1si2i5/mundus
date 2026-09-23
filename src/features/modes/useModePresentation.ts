import { useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import type { GeoPoint } from '../globe/geo';
import type { CountryRef } from '../globe/countryData';
import {
  createAntipodeRelation,
  type AntipodeRelation,
} from '../antipodes/relation';
import {
  developmentColor,
  valuesByCountryId,
} from '../development/developmentData';
import {
  useDevelopmentDataset,
  type DevelopmentLoadState,
} from '../development/useDevelopmentDataset';
import { observeSun, solarEventsUtc, solarPosition } from '../sunline/solar';
import type { SunlineRenderState } from '../globe/GlobeViewport';
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

export interface GlobePresentation {
  countryFills: ReadonlyMap<string, string> | null;
  showAntipodes: boolean;
  sunline: SunlineRenderState | null;
  antipodeRelation: AntipodeRelation | null;
  surnameMapLabels: readonly SurnameMapLabel[];
  surnameDisplayMode: SurnameDisplayMode;
}

export type AntipodeRelationLoadState = 'idle' | 'loading' | 'error' | 'ready';

export type ModePresentation =
  | {
      id: 'antipodes';
      globe: GlobePresentation;
      selectedCountry: CountryRef | null;
      antipodeCountry: CountryRef | null;
      relation: AntipodeRelation;
      relationStatus: AntipodeRelationLoadState;
      cityIndex: GeoNamesCityLoadState;
    }
  | {
      id: 'development';
      globe: GlobePresentation;
      selectedCountry: CountryRef | null;
      developmentData: DevelopmentLoadState;
    }
  | {
      id: 'sunline';
      globe: GlobePresentation;
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
      globe: GlobePresentation;
      selectedCountry: CountryRef | null;
      surnameData: SurnameLoadState;
    };

/**
 * Returns the active-mode presentation, or `null` when the shell is in the
 * neutral lobby. Inactive-mode resources stay idle and inactive-mode
 * computations are skipped.
 */
export function useModePresentation(): ModePresentation | null {
  const activeMode = useAppStore((state) => state.activeMode);
  const point = useAppStore((state) => state.point);
  const selectedCountry = useAppStore((state) => state.selectedCountry);
  const antipodeCountry = useAppStore((state) => state.antipodeCountry);
  const indicator = useAppStore((state) => state.developmentIndicator);
  const year = useAppStore((state) => state.developmentYear);
  const sunlineTimeMs = useAppStore((state) => state.sunlineTimeMs);
  const surnameDisplayMode =
    useAppStore((state) => state.surnameDisplayMode) ??
    DEFAULT_SURNAME_DISPLAY_MODE;
  const developmentData = useDevelopmentDataset(activeMode === 'development');
  const cityIndex = useGeoNamesCityIndex(activeMode === 'antipodes');
  const surnameData = useSurnameDataset(activeMode === 'surnames');

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
  const developmentFills = useMemo(() => {
    if (activeMode !== 'development' || developmentData.status !== 'ready') {
      return null;
    }
    return new Map(
      [...valuesByCountryId(developmentData.data, indicator, year)].map(
        ([countryId, value]) => [countryId, developmentColor(value)],
      ),
    );
  }, [activeMode, developmentData, indicator, year]);
  const sun = useMemo(() => {
    if (activeMode !== 'sunline') return null;
    const position = solarPosition(sunlineTimeMs);
    return {
      position,
      observation: observeSun(point, sunlineTimeMs),
      events: solarEventsUtc(point, sunlineTimeMs),
    };
  }, [activeMode, point, sunlineTimeMs]);
  const surnameMapLabel = useMemo(() => {
    if (
      activeMode !== 'surnames' ||
      !selectedCountry ||
      surnameData.status !== 'ready'
    ) {
      return null;
    }
    const country = surnameData.data.countriesById.get(
      selectedCountry.countryId,
    );
    const record = getDisplaySurnameRecord(country);
    return record
      ? {
          countryId: selectedCountry.countryId,
          countryName: selectedCountry.name,
          record,
        }
      : null;
  }, [activeMode, selectedCountry, surnameData]);

  switch (activeMode) {
    case null:
      return null;
    case 'antipodes':
      return {
        id: activeMode,
        globe: {
          countryFills: null,
          showAntipodes: true,
          sunline: null,
          antipodeRelation: relation,
          surnameMapLabels: [],
          surnameDisplayMode,
        },
        selectedCountry,
        antipodeCountry,
        // activeMode === 'antipodes' guarantees a non-null relation.
        relation: relation!,
        relationStatus: cityIndex.status,
        cityIndex,
      };
    case 'development':
      return {
        id: activeMode,
        globe: {
          countryFills: developmentFills,
          showAntipodes: false,
          sunline: null,
          antipodeRelation: null,
          surnameMapLabels: [],
          surnameDisplayMode,
        },
        selectedCountry,
        developmentData,
      };
    case 'sunline':
      return {
        id: activeMode,
        globe: {
          countryFills: null,
          showAntipodes: false,
          sunline: { subsolarPoint: sun!.position.subsolarPoint },
          antipodeRelation: null,
          surnameMapLabels: [],
          surnameDisplayMode,
        },
        point,
        selectedCountry,
        // activeMode === 'sunline' guarantees a non-null sun.
        sun: sun!,
      };
    case 'surnames':
      return {
        id: activeMode,
        globe: {
          countryFills: null,
          showAntipodes: false,
          sunline: null,
          antipodeRelation: null,
          surnameMapLabels: surnameMapLabel ? [surnameMapLabel] : [],
          surnameDisplayMode,
        },
        selectedCountry,
        surnameData,
      };
    default:
      return assertNever(activeMode);
  }
}

/**
 * A defensive globe-only presentation for the base Canvas. Unlike
 * `useModePresentation`, this never throws: any mode-calculation failure
 * degrades to a neutral globe instead of taking down the shell.
 */
export function useGlobePresentation(): GlobePresentation {
  const activeMode = useAppStore((state) => state.activeMode);
  const point = useAppStore((state) => state.point);
  const indicator = useAppStore((state) => state.developmentIndicator);
  const year = useAppStore((state) => state.developmentYear);
  const sunlineTimeMs = useAppStore((state) => state.sunlineTimeMs);
  const developmentData = useDevelopmentDataset(activeMode === 'development');
  const cityIndex = useGeoNamesCityIndex(activeMode === 'antipodes');
  const surnameData = useSurnameDataset(activeMode === 'surnames');
  const surnameDisplayMode =
    useAppStore((state) => state.surnameDisplayMode) ??
    DEFAULT_SURNAME_DISPLAY_MODE;

  const countryFills = useMemo(() => {
    if (activeMode !== 'development' || developmentData.status !== 'ready') {
      return null;
    }
    try {
      return new Map(
        [...valuesByCountryId(developmentData.data, indicator, year)].map(
          ([countryId, value]) => [countryId, developmentColor(value)],
        ),
      );
    } catch {
      return null;
    }
  }, [activeMode, developmentData, indicator, year]);

  const sunline = useMemo(() => {
    if (activeMode !== 'sunline') return null;
    try {
      return { subsolarPoint: solarPosition(sunlineTimeMs).subsolarPoint };
    } catch {
      return null;
    }
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
    try {
      return createAntipodeRelation(
        point,
        cityIndex.status === 'ready' ? cityIndex.data : undefined,
      );
    } catch {
      return null;
    }
  }, [activeMode, cityIndex, point]);

  return {
    countryFills,
    showAntipodes: activeMode === 'antipodes',
    sunline,
    antipodeRelation,
    surnameMapLabels,
    surnameDisplayMode,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled mode: ${String(value)}`);
}
