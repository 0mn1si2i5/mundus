import { useMemo } from 'react';
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

export interface GlobePresentation {
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
  const sunlineTimeMs = useAppStore((state) => state.sunlineTimeMs);
  const surnameDisplayMode =
    useAppStore((state) => state.surnameDisplayMode) ??
    DEFAULT_SURNAME_DISPLAY_MODE;
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
  const sun = useMemo(() => {
    if (activeMode !== 'sunline') return null;
    const position = solarPosition(sunlineTimeMs);
    return {
      position,
      observation: observeSun(point, sunlineTimeMs),
      events: solarEventsUtc(point, sunlineTimeMs),
    };
  }, [activeMode, point, sunlineTimeMs]);
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
  const sunlineTimeMs = useAppStore((state) => state.sunlineTimeMs);
  const cityIndex = useGeoNamesCityIndex(activeMode === 'antipodes');
  const surnameData = useSurnameDataset(activeMode === 'surnames');
  const surnameDisplayMode =
    useAppStore((state) => state.surnameDisplayMode) ??
    DEFAULT_SURNAME_DISPLAY_MODE;

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
