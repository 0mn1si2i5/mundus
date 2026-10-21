import { messages, type Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import type { ModePresentation } from '../modes/useModePresentation';
import { displayCountryName } from '../globe/countryNames';
import { CLIMATE_COPY } from './climateCopy';
import { formatLandShare, type ClimateCityMatch } from './climateMetrics';
import {
  KOPPEN_CLASSES,
  KOPPEN_GROUP_NAMES,
  koppenClass,
  type KoppenGroup,
} from './koppenClasses';
import modeStyles from '../modes/ModeResult.module.css';
import styles from './ClimateResult.module.css';

const GROUPS: readonly KoppenGroup[] = ['A', 'B', 'C', 'D', 'E'];

export function formatLandShare(share: number, locale: Locale): string {
  if (share > 0 && share < 0.001)
    return locale === 'zh' ? '不到 0.1%' : '<0.1%';
  return `${(share * 100).toFixed(1)}%`;
}

export function ClimateResult({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: Extract<ModePresentation, { id: 'climate' }>;
}) {
  const t = CLIMATE_COPY[locale];
  const selectPoint = useAppStore((state) => state.selectPoint);
  const { data, cities, twins, point, selectedCountry } = presentation;
  if (data.status === 'idle' || data.status === 'loading')
    return (
      <aside className={modeStyles.result} role="status">
        <p className={modeStyles.status}>{t.loading}</p>
      </aside>
    );
  if (data.status === 'error')
    return (
      <aside className={modeStyles.result} role="status">
        <div className={modeStyles.status}>
          <p>{t.unavailable}</p>
          <button
            type="button"
            className={modeStyles.retry}
            onClick={data.retry}
          >
            {t.retry}
          </button>
        </div>
      </aside>
    );
  const sample = twins?.sample ?? null;
  const selected = sample ? koppenClass(sample.value) : null;
  const numberFormatter = new Intl.NumberFormat(
    locale === 'zh' ? 'zh-CN' : 'en-US',
    { maximumFractionDigits: 0 },
  );
  const cityList = (
    label: string,
    matches: readonly ClimateCityMatch[] | undefined,
  ) => (
    <section className={styles.cities} aria-label={label}>
      <h2 className={modeStyles.label}>{label}</h2>
      {cities.status === 'ready' && matches ? (
        matches.length ? (
          <ul>
            {matches.map((match) => {
              const type = koppenClass(match.value)!;
              return (
                <li key={match.city.id}>
                  <button
                    type="button"
                    className={modeStyles.cityButton}
                    onClick={() => selectPoint(match.city.point)}
                  >
                    <span className={modeStyles.cityName}>
                      {match.city.name[locale]}
                    </span>
                    <span className={styles.code}>
                      <Swatch rgb={type.rgb} />
                      {type.code}
                    </span>
                  </button>
                  <small>
                    {match.city.country[locale]} · {type.name[locale]} ·{' '}
                    {t.distance.replace(
                      '{km}',
                      numberFormatter.format(match.distanceKm),
                    )}
                  </small>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={modeStyles.status}>{t.none}</p>
        )
      ) : (
        <p className={modeStyles.status}>
          {cities.status === 'error' ? t.citiesUnavailable : t.citiesLoading}
        </p>
      )}
    </section>
  );
  return (
    <aside
      className={`${modeStyles.result} ${styles.result}`}
      aria-label={t.result}
      data-testid="climate-result"
      data-climate-class={selected?.code ?? 'none'}
    >
      <div className={modeStyles.endpoint}>
        <span className={modeStyles.label}>{t.selected}</span>
        <em className={modeStyles.place}>
          {selectedCountry
            ? displayCountryName(selectedCountry, locale)
            : messages[locale].openOcean}
        </em>
        <span className={modeStyles.coords}>
          {point.latitude.toFixed(2)}°, {point.longitude.toFixed(2)}°
        </span>
      </div>
      {selected ? (
        <div className={styles.badge}>
          <Swatch rgb={selected.rgb} large />
          <strong>{selected.code}</strong>
          <span>{selected.name[locale]}</span>
        </div>
      ) : null}
      <p className={styles.finding} aria-live="polite">
        {selected
          ? t.finding
              .replace('{code}', selected.code)
              .replace('{name}', selected.name[locale])
              .replace(
                '{share}',
                formatLandShare(
                  data.data.landShare[selected.value - 1] ?? 0,
                  locale,
                ),
              )
          : t.ocean}
      </p>
      {sample?.snapped ? (
        <p className={modeStyles.status}>{t.snapped}</p>
      ) : null}
      {cityList(
        selected ? t.sameLatitude : t.sameLatitudeOcean,
        twins?.sameLatitude,
      )}
      {selected ? cityList(t.farTwins, twins?.farTwins) : null}
      <details className={styles.legend}>
        <summary>{t.legend}</summary>
        <p className={modeStyles.status}>{t.legendHint}</p>
        {GROUPS.map((group) => (
          <section key={group} aria-label={KOPPEN_GROUP_NAMES[group][locale]}>
            <h3>
              {group} · {KOPPEN_GROUP_NAMES[group][locale]}
            </h3>
            <ul>
              {KOPPEN_CLASSES.filter((type) => type.group === group).map(
                (type) => (
                  <li
                    key={type.code}
                    aria-current={
                      type.value === selected?.value ? 'true' : undefined
                    }
                  >
                    <Swatch rgb={type.rgb} />
                    <span className={styles.legendCode}>{type.code}</span>
                    <span>{type.name[locale]}</span>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
      </details>
      <p className={styles.caveat}>{t.caveat}</p>
    </aside>
  );
}

function Swatch({
  rgb,
  large = false,
}: {
  rgb: readonly [number, number, number];
  large?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={large ? `${styles.swatch} ${styles.large}` : styles.swatch}
      style={{ backgroundColor: `rgb(${rgb.join(' ')})` }}
    />
  );
}
