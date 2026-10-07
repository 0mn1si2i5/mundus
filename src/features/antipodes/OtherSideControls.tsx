import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import type { Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import { ModePanel, type ModePanelHandle } from '../controls/ModePanel';
import { FEATURED_CITIES } from './cities';
import type { GeoPoint } from '../globe/geo';
import { CityAutocomplete } from './CityAutocomplete';
import type { GeoNamesCityLoadState } from './useGeoNamesCityIndex';
import styles from './OtherSideControls.module.css';

const requiredCoordinate = (minimum: number, maximum: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.coerce.number().min(minimum).max(maximum),
  );

const coordinateSchema = z.object({
  latitude: requiredCoordinate(-90, 90),
  longitude: requiredCoordinate(-180, 180),
});

const COPY = {
  zh: {
    title: '选择起点',
    coordinates: '输入经纬度',
    latitude: '纬度',
    longitude: '经度',
    apply: '前往',
    locate: '我的位置',
    locating: '定位中…',
    locationError: '无法读取位置，请检查浏览器权限。',
    invalid: '纬度需在 ±90°、经度需在 ±180° 内。',
    viewAntipode: '翻到对跖点',
    returnOrigin: '返回起点',
    examples: '快速选择',
    show: '展开地点控件',
    hide: '收起地点控件',
  },
  en: {
    title: 'Starting point',
    coordinates: 'Enter coordinates',
    latitude: 'Latitude',
    longitude: 'Longitude',
    apply: 'Go',
    locate: 'My location',
    locating: 'Locating…',
    locationError: 'Location is unavailable. Check browser permission.',
    invalid: 'Latitude must be within ±90° and longitude within ±180°.',
    viewAntipode: 'View antipode',
    returnOrigin: 'Return to origin',
    examples: 'Quick picks',
    show: 'Expand place controls',
    hide: 'Collapse place controls',
  },
} as const;

export function OtherSideControls({
  locale,
  cityIndex,
}: {
  locale: Locale;
  cityIndex: GeoNamesCityLoadState;
}) {
  const point = useAppStore((state) => state.point);
  const selectPoint = useAppStore((state) => state.selectPoint);
  const cameraSide = useAppStore((state) => state.cameraFocusIntent.side);
  const toggleAntipodeFocus = useAppStore((state) => state.toggleAntipodeFocus);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const panel = useRef<ModePanelHandle>(null);
  const copy = COPY[locale];

  function choosePoint(selectedPoint: GeoPoint) {
    selectPoint(selectedPoint);
    setError('');
    panel.current?.collapseIfMobile();
  }

  function submitCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = coordinateSchema.safeParse({
      latitude: data.get('latitude'),
      longitude: data.get('longitude'),
    });
    if (!parsed.success) {
      setError(copy.invalid);
      return;
    }
    selectPoint(parsed.data);
    setError('');
  }

  function locate() {
    if (!navigator.geolocation) {
      setError(copy.locationError);
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        selectPoint({ latitude: coords.latitude, longitude: coords.longitude });
        setLocating(false);
      },
      () => {
        setError(copy.locationError);
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }

  return (
    <ModePanel
      ref={panel}
      id="place-controls"
      title={copy.title}
      expandLabel={copy.show}
      collapseLabel={copy.hide}
      headerActions={
        <button
          type="button"
          className={styles.flip}
          onClick={toggleAntipodeFocus}
        >
          {cameraSide === 'antipode' ? copy.returnOrigin : copy.viewAntipode}{' '}
          <span aria-hidden="true">↗</span>
        </button>
      }
    >
      <>
        <CityAutocomplete
          locale={locale}
          loadState={cityIndex}
          onSelect={(city) => choosePoint(city.point)}
        />

        <div
          className={styles.examples}
          role="group"
          aria-label={copy.examples}
        >
          {FEATURED_CITIES.map((city) => (
            <button
              key={city.id}
              type="button"
              onClick={() => choosePoint(city.point)}
            >
              {city.name[locale]}
            </button>
          ))}
          <button
            type="button"
            className={styles.locate}
            onClick={locate}
            disabled={locating}
          >
            <span aria-hidden="true">◎</span>
            {locating ? copy.locating : copy.locate}
          </button>
        </div>

        <details className={styles.coordinatesDisclosure}>
          <summary>{copy.coordinates}</summary>
          <form
            key={`${point.latitude},${point.longitude}`}
            className={styles.coordinates}
            onSubmit={submitCoordinates}
          >
            <label>
              <span>{copy.latitude}</span>
              <input
                name="latitude"
                inputMode="decimal"
                defaultValue={point.latitude.toFixed(4)}
              />
            </label>
            <label>
              <span>{copy.longitude}</span>
              <input
                name="longitude"
                inputMode="decimal"
                defaultValue={point.longitude.toFixed(4)}
              />
            </label>
            <button type="submit">{copy.apply}</button>
          </form>
        </details>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </>
    </ModePanel>
  );
}
