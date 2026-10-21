import { useCallback, useEffect } from 'react';
import { useAppStore } from '../../state/appStore';
import { getCountryLabelAnchorForId } from '../globe/countryLabel';
import type { GeoPoint } from '../globe/geo';

/** Sets the destination and turns the globe toward the middle of the trip. */
export function useChooseDestination(): (countryId: string | null) => void {
  const setDestination = useAppStore((state) => state.setBordersDestination);
  const requestCameraFocus = useAppStore((state) => state.requestCameraFocus);
  return useCallback(
    (countryId) => {
      setDestination(countryId);
      if (!countryId) return;
      const anchor = getCountryLabelAnchorForId(countryId);
      if (!anchor) return;
      requestCameraFocus(
        greatCircleMidpoint(useAppStore.getState().point, anchor.point),
      );
    },
    [requestCameraFocus, setDestination],
  );
}

/** On entry, turns the globe toward the start, or the trip once one is set. */
export function useFocusTripOnEnter(): void {
  const requestCameraFocus = useAppStore((state) => state.requestCameraFocus);
  useEffect(() => {
    const { point, bordersDestination } = useAppStore.getState();
    const anchor = bordersDestination
      ? getCountryLabelAnchorForId(bordersDestination)
      : null;
    requestCameraFocus(
      anchor ? greatCircleMidpoint(point, anchor.point) : point,
    );
  }, [requestCameraFocus]);
}

/** Midpoint of the shorter great-circle arc; the second point if antipodal. */
export function greatCircleMidpoint(a: GeoPoint, b: GeoPoint): GeoPoint {
  const [ax, ay, az] = toVector(a);
  const [bx, by, bz] = toVector(b);
  const x = ax + bx;
  const y = ay + by;
  const z = az + bz;
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) return b;
  return {
    latitude: (Math.asin(z / length) * 180) / Math.PI,
    longitude: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

function toVector({ latitude, longitude }: GeoPoint): [number, number, number] {
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  return [
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  ];
}
