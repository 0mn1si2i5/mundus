import { useMemo, useState } from 'react';
import { messages, type Locale } from '../../i18n/messages';
import { displayCityReachCountry, displayCityReachName } from './cityReachData';
import type {
  CityReachCity,
  CityReachMetadata,
  CityReachPointSelection,
} from './cityReachTypes';
import type { CityReachFieldState } from './useCityReachField';
import { cityReachCentreStatus } from './cityReachPresentation';
import styles from '../modes/ModeResult.module.css';
import fieldStyles from './IsolationControls.module.css';

export function CityReachResult({
  locale,
  field,
  selection,
}: {
  locale: Locale;
  field: CityReachFieldState;
  selection: CityReachPointSelection | null;
}) {
  const t = messages[locale];
  const [inspectedId, setInspectedId] = useState<number | null>(null);
  const choices = useMemo(
    () =>
      [...(field.metadata?.inspectableCities ?? [])].sort(
        (a, b) =>
          displayCityReachName(a, locale).localeCompare(
            displayCityReachName(b, locale),
            locale === 'zh' ? 'zh-CN' : 'en',
          ) || a.id - b.id,
      ),
    [field.metadata, locale],
  );
  const owner = selection?.status === 'owned' ? selection.city : null;
  const inspected =
    (inspectedId !== null ? field.metadata?.byId.get(inspectedId) : owner) ??
    null;
  const statusNote =
    field.status === 'error' ? t.isolationFieldError : t.isolationFieldLoading;
  const number = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US');
  return (
    <aside
      className={`${styles.result} ${styles.surnameResult}`}
      aria-live="polite"
      aria-label={t.isolationResult}
      data-city-reach-owner-id={owner?.id}
      data-city-reach-selection={selection?.status}
    >
      {field.status !== 'ready' ? (
        <div className={styles.status}>
          <p>
            {statusNote}{' '}
            {field.frame
              ? t.cityReachShowingPrevious.replace(
                  '{k}',
                  String(field.frame.level),
                )
              : ''}
          </p>
          {field.status === 'error' ? (
            <button
              type="button"
              className={styles.retry}
              onClick={field.retry}
            >
              {t.isolationRetry}
            </button>
          ) : null}
        </div>
      ) : null}
      {selection && field.frame ? (
        <>
          <div className={styles.endpoint}>
            <span className={styles.label}>
              {t.cityReachOwner.replace('{k}', String(field.frame.level))}
            </span>
            {owner ? (
              <>
                <em className={styles.place}>
                  {displayCityReachName(owner, locale)}
                </em>
                <small>{displayCityReachCountry(owner, locale)}</small>
              </>
            ) : (
              <p>
                {selection.status === 'disputed'
                  ? t.cityReachDisputed
                  : selection.status === 'unreachable'
                    ? t.cityReachUnreachable
                    : t.cityReachOutside}
              </p>
            )}
          </div>
          {owner ? (
            <dl className={styles.facts}>
              <div className={styles.wide}>
                <dt>{t.isolationPopulation}</dt>
                <dd>{number.format(Math.round(owner.population))}</dd>
              </div>
            </dl>
          ) : null}
        </>
      ) : null}
      {field.metadata ? (
        <section>
          <label className={fieldStyles.centerPicker}>
            <span>{t.cityReachInspect}</span>
            <select
              value={inspected?.id ?? ''}
              onChange={(event) =>
                setInspectedId(
                  event.target.value ? Number(event.target.value) : null,
                )
              }
            >
              <option value="">{t.cityReachChooseCenter}</option>
              {choices.map((city) => (
                <option key={city.id} value={city.id}>
                  {displayCityReachName(city, locale)} ·{' '}
                  {displayCityReachCountry(city, locale)}
                </option>
              ))}
            </select>
          </label>
          {inspected ? (
            <CityReachCentreFacts
              city={inspected}
              metadata={field.metadata}
              locale={locale}
            />
          ) : null}
        </section>
      ) : null}
      <p className={styles.note}>{t.cityReachCaveat}</p>
    </aside>
  );
}

function CityReachCentreFacts({
  city,
  metadata,
  locale,
}: {
  city: CityReachCity;
  metadata: CityReachMetadata;
  locale: Locale;
}) {
  const t = messages[locale];
  const parent =
    city.parentId !== null ? metadata.byId.get(city.parentId) : null;
  const merged =
    city.mergedIntoId !== null ? metadata.byId.get(city.mergedIntoId) : null;
  const name = (value: CityReachCity) =>
    `${displayCityReachName(value, locale)} · ${displayCityReachCountry(value, locale)}`;
  return (
    <dl className={styles.facts} data-city-reach-inspected-id={city.id}>
      <div className={styles.wide}>
        <dt>{t.cityReachThreshold}</dt>
        <dd>
          {cityReachCentreStatus(city, locale)}
          {merged ? ` · ${name(merged)}` : ''}
        </dd>
      </div>
      {parent ? (
        <div className={styles.wide}>
          <dt>{t.cityReachParent}</dt>
          <dd>{name(parent)}</dd>
        </div>
      ) : null}
    </dl>
  );
}
