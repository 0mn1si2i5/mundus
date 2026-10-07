import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import { chordDistanceKm, surfaceDistanceKm } from '../antipodes/distance';
import type { ModePresentation } from './useModePresentation';
import styles from './ModeResult.module.css';
import type { GeoPoint } from '../globe/geo';
import {
  getSurnameDisplayForms,
  resolveSurnameWordmark,
} from '../surnames/surnameWordmark';
import { SurnameScriptToggle } from '../surnames/SurnameScriptToggle';
import type { SurnameRecord } from '../surnames/surnameData';

export function ModeResult({
  locale,
  presentation,
  onCameraFocus,
}: {
  locale: Locale;
  presentation: ModePresentation;
  onCameraFocus: (point: GeoPoint) => void;
}) {
  const t = messages[locale];
  switch (presentation.id) {
    case 'antipodes': {
      const numberFormatter = new Intl.NumberFormat(
        locale === 'zh' ? 'zh-CN' : 'en-US',
        { maximumFractionDigits: 0 },
      );
      const relation = presentation.relation;
      const citiesReady =
        relation.origin.nearestMajorCity && relation.antipode.nearestMajorCity;
      return (
        <aside
          className={styles.result}
          aria-live="polite"
          aria-label={t.result}
        >
          <RelationSide
            exactLabel={t.selectedPoint}
            country={presentation.selectedCountry?.name ?? t.openOcean}
            point={relation.origin.exactPoint}
            cityLabel={t.originMajorCity}
            side={relation.origin}
            locale={locale}
            distanceLabel={t.distanceFromExactPoint}
            focusLabel={t.focusMajorCity}
            numberFormatter={numberFormatter}
            onCameraFocus={onCameraFocus}
          />
          <dl className={styles.passage}>
            <div>
              <dt>{t.coreDistance}</dt>
              <dd>
                {numberFormatter.format(
                  chordDistanceKm(
                    relation.origin.exactPoint,
                    relation.antipode.exactPoint,
                  ),
                )}{' '}
                km
              </dd>
            </div>
            <div>
              <dt>{t.surfaceDistance}</dt>
              <dd>
                {numberFormatter.format(
                  surfaceDistanceKm(
                    relation.origin.exactPoint,
                    relation.antipode.exactPoint,
                  ),
                )}{' '}
                km
              </dd>
            </div>
          </dl>
          <RelationSide
            exactLabel={t.antipode}
            country={presentation.antipodeCountry?.name ?? t.openOcean}
            point={relation.antipode.exactPoint}
            cityLabel={t.antipodeMajorCity}
            side={relation.antipode}
            locale={locale}
            distanceLabel={t.distanceFromExactPoint}
            focusLabel={t.focusMajorCity}
            numberFormatter={numberFormatter}
            onCameraFocus={onCameraFocus}
          />
          {citiesReady ? null : (
            <p className={styles.status} data-testid="antipode-relation-status">
              {presentation.relationStatus === 'error'
                ? t.majorCitiesUnavailable
                : t.majorCitiesLoading}
            </p>
          )}
        </aside>
      );
    }
    case 'development':
      return null;
    case 'sunline': {
      const { observation, events, position } = presentation.sun;
      return (
        <aside
          className={`${styles.result} ${styles.sunlineResult}`}
          aria-live="polite"
          aria-label={t.sunlineResult}
        >
          <div className={styles.endpoint}>
            <span className={styles.label}>{t.selectedPoint}</span>
            <em className={styles.place}>
              {presentation.selectedCountry?.name ?? t.openOcean}
            </em>
            <span className={styles.coords}>
              {presentation.point.latitude.toFixed(2)}°,{' '}
              {presentation.point.longitude.toFixed(2)}°
            </span>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>{t.solarAltitude}</dt>
              <dd>{observation.altitudeDegrees.toFixed(1)}°</dd>
            </div>
            <div>
              <dt>{t.daylightState}</dt>
              <dd className={styles.daylight}>
                {observation.daylight === 'day'
                  ? t.daylightDay
                  : observation.daylight === 'civil-twilight'
                    ? t.daylightTwilight
                    : t.daylightNight}
              </dd>
            </div>
            {events.status === 'normal' ? (
              <>
                <div>
                  <dt>{t.sunrise}</dt>
                  <dd>{formatUtcEvent(events.sunriseMs)}</dd>
                </div>
                <div>
                  <dt>{t.sunset}</dt>
                  <dd>{formatUtcEvent(events.sunsetMs)}</dd>
                </div>
              </>
            ) : (
              <div className={styles.wide}>
                <dt>{t.sunrise}</dt>
                <dd className={styles.daylight}>
                  {events.status === 'polar-day' ? t.polarDay : t.polarNight}
                </dd>
              </div>
            )}
            <div className={styles.wide}>
              <dt>{t.subsolarPoint}</dt>
              <dd>
                {position.subsolarPoint.latitude.toFixed(2)}°,{' '}
                {position.subsolarPoint.longitude.toFixed(2)}°
              </dd>
            </div>
          </dl>
        </aside>
      );
    }
    case 'surnames': {
      const country = presentation.selectedCountry;
      const loadState = presentation.surnameData;
      const countryData =
        country && loadState.status === 'ready'
          ? loadState.data.countriesById.get(country.countryId)
          : null;
      const records = countryData?.records ?? [];
      const displayRecord =
        records.find((record) => record.rank === 1) ?? records[0] ?? null;
      const otherRecords = records.filter((record) => record !== displayRecord);
      const wordmark = displayRecord
        ? resolveSurnameWordmark(displayRecord, presentation.surnameDisplayMode)
        : null;
      return (
        <aside
          className={`${styles.result} ${styles.surnameResult}`}
          aria-live="polite"
          aria-label={t.surnameResult}
          data-testid="surname-result"
          data-surname-label-obstacle
        >
          <SurnameScriptToggle locale={locale} />
          <div className={styles.endpoint}>
            <span className={styles.label}>{t.selectedCountryLabel}</span>
            <em className={styles.place}>
              {country?.name ?? t.surnameChooseCountry}
            </em>
          </div>
          {wordmark ? (
            <div className={styles.wordmark}>
              <span className={styles.visuallyHidden}>{t.surnameWordmark}</span>
              <strong>{wordmark.value}</strong>
              {wordmark.fellBack ? (
                <small>
                  {t.surnameWordmarkFallback}
                  {
                    {
                      local: t.surnameDisplayLocal,
                      latin: t.surnameDisplayLatin,
                      chinese: t.surnameDisplayChinese,
                    }[wordmark.source]
                  }
                </small>
              ) : null}
            </div>
          ) : null}
          {!country ? (
            <p className={styles.status}>{t.surnameSelectOnGlobe}</p>
          ) : loadState.status === 'loading' ? (
            <p className={styles.status}>{t.surnameLoading}</p>
          ) : loadState.status === 'error' ? (
            <div className={styles.status}>
              <p>{t.surnameUnavailable}</p>
              <button
                className={styles.retry}
                type="button"
                onClick={loadState.retry}
              >
                {t.surnameRetry}
              </button>
            </div>
          ) : displayRecord ? (
            <>
              <SurnameRecordFacts
                record={displayRecord}
                locale={locale}
                sourceUrls={countryData?.sourceUrls ?? []}
              />
              {otherRecords.length > 0 ? (
                <details className={styles.otherRecords}>
                  <summary>
                    {t.surnameOtherRecords} · {otherRecords.length}
                  </summary>
                  <ul>
                    {otherRecords.map((record, index) => {
                      const forms = getSurnameDisplayForms(record);
                      const value =
                        presentation.surnameDisplayMode === 'chinese'
                          ? (forms.chinese ?? forms.local)
                          : presentation.surnameDisplayMode === 'latin'
                            ? (forms.latin ?? forms.local)
                            : (forms.local ?? forms.latin);
                      return <li key={`${value}-${index}`}>{value}</li>;
                    })}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <p className={styles.status}>{t.surnameNoRecord}</p>
          )}
        </aside>
      );
    }
    default:
      return assertNever(presentation);
  }
}

function RelationSide({
  exactLabel,
  country,
  point,
  cityLabel,
  side,
  locale,
  distanceLabel,
  focusLabel,
  numberFormatter,
  onCameraFocus,
}: {
  exactLabel: string;
  country: string;
  point: GeoPoint;
  cityLabel: string;
  side: import('../antipodes/relation').AntipodeRelationSide | null;
  locale: Locale;
  distanceLabel: string;
  focusLabel: string;
  numberFormatter: Intl.NumberFormat;
  onCameraFocus: (point: GeoPoint) => void;
}) {
  const city = side?.nearestMajorCity;
  return (
    <section className={styles.endpoint}>
      <span className={styles.label}>{exactLabel}</span>
      <em className={styles.place}>{country}</em>
      <span className={styles.coords}>
        {point.latitude.toFixed(4)}°, {point.longitude.toFixed(4)}°
      </span>
      {city ? (
        <div className={styles.city} role="region" aria-label={cityLabel}>
          <button
            type="button"
            className={styles.cityButton}
            onClick={() => onCameraFocus(city.city.point)}
          >
            <span className={styles.cityName}>{city.city.name[locale]}</span>
            <span className={styles.cityFocus}>{focusLabel}</span>
          </button>
          <small>
            {[city.city.admin1?.[locale], city.city.country[locale]]
              .filter(Boolean)
              .join(', ')}
            {' · '}
            {distanceLabel} {numberFormatter.format(city.distanceKm)} km
          </small>
        </div>
      ) : null}
    </section>
  );
}

function SurnameRecordFacts({
  record,
  locale,
  sourceUrls,
}: {
  record: SurnameRecord;
  locale: Locale;
  sourceUrls: readonly string[];
}) {
  const t = messages[locale];
  const forms = getSurnameDisplayForms(record);
  const numberFormatter = new Intl.NumberFormat(
    locale === 'zh' ? 'zh-CN' : 'en-US',
  );
  const scripts = record.localForms
    .map((form) => form.script)
    .filter(Boolean)
    .join(', ');
  const statistics = [
    record.count !== null
      ? [t.surnameCount, numberFormatter.format(record.count)]
      : null,
    record.share !== null
      ? [t.surnameShare, `${(record.share * 100).toFixed(2)}%`]
      : null,
    record.statYear !== null ? [t.surnameYear, String(record.statYear)] : null,
  ].filter((entry): entry is [string, string] => entry !== null);
  return (
    <div className={styles.surnameFacts}>
      <p className={styles.badge} data-kind={record.observationKind}>
        {record.rank !== null
          ? `${t.surnameRank} ${record.rank}`
          : record.observationKind === 'manual-observation'
            ? t.surnameManualObservation
            : t.surnameListed}
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>
            {t.surnameDisplayLocal}
            {scripts ? ` · ${scripts}` : ''}
          </dt>
          <dd>{forms.local ?? t.surnameMissing}</dd>
        </div>
        <div>
          <dt>{t.surnameDisplayLatin}</dt>
          <dd>{forms.latin ?? t.surnameMissing}</dd>
        </div>
        <div>
          <dt>{t.surnameDisplayChinese}</dt>
          <dd>{forms.chinese ?? t.surnameMissing}</dd>
        </div>
        {statistics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {statistics.length === 0 ? (
        <p className={styles.note}>{t.surnameNoStatistics}</p>
      ) : null}
      {sourceUrls.length > 0 ? (
        <p className={styles.sources}>
          {sourceUrls.map((url, index) => (
            <a href={url} key={url} rel="noreferrer" target="_blank">
              {t.surnameSourceLink}
              {sourceUrls.length > 1 ? ` ${index + 1}` : ''} ↗
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function formatUtcEvent(timestampMs: number): string {
  return `${new Date(timestampMs).toISOString().slice(5, 16).replace('T', ' ')} UTC`;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled result: ${String(value)}`);
}
