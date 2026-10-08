import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import type { ModePresentation } from '../modes/useModePresentation';
import { displayIsolationCountry, displayIsolationName } from './isolationData';
import { IsolationStepChart } from './IsolationStepChart';
import styles from '../modes/ModeResult.module.css';

export function IsolationResult({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: Extract<ModePresentation, { id: 'isolation' }>;
}) {
  const t = messages[locale];
  const numberFormatter = new Intl.NumberFormat(
    locale === 'zh' ? 'zh-CN' : 'en-US',
  );
  const load = presentation.dataset;
  if (load.status === 'loading' || load.status === 'idle')
    return (
      <aside
        className={styles.result}
        aria-live="polite"
        aria-label={t.isolationResult}
      >
        <p className={styles.status}>{t.isolationLoading}</p>
      </aside>
    );
  if (load.status === 'error')
    return (
      <aside
        className={styles.result}
        aria-live="polite"
        aria-label={t.isolationResult}
      >
        <div className={styles.status}>
          <p>{t.isolationUnavailable}</p>
          <button className={styles.retry} type="button" onClick={load.retry}>
            {t.isolationRetry}
          </button>
        </div>
      </aside>
    );
  const selection = presentation.selection;
  if (!selection)
    return (
      <aside
        className={styles.result}
        aria-live="polite"
        aria-label={t.isolationResult}
      >
        <p className={styles.status}>{t.isolationLoading}</p>
      </aside>
    );
  const city = load.data.cities[selection.cityIndex]!;
  const holders = load.data.holders[selection.cityIndex] ?? [];
  const competitor = selection.competitor
    ? load.data.cities[selection.competitor.index]
    : null;
  const nearestNote =
    selection.distanceFromPointKm > 50
      ? t.isolationNearestNote.replace(
          '{d}',
          numberFormatter.format(Math.round(selection.distanceFromPointKm)),
        )
      : null;
  const population = numberFormatter.format(Math.round(city.population));
  const percent = Math.round(presentation.alpha * 100);
  return (
    <aside
      className={`${styles.result} ${styles.surnameResult}`}
      aria-live="polite"
      aria-label={t.isolationResult}
    >
      <div className={styles.endpoint}>
        <span className={styles.label}>{t.selectedPoint}</span>
        <em className={styles.place}>{displayIsolationName(city, locale)}</em>
        <small>{displayIsolationCountry(city, locale)}</small>
        {nearestNote ? <small>{nearestNote}</small> : null}
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>{t.isolationPopulation}</dt>
          <dd>{population}</dd>
        </div>
        <div>
          <dt>{t.isolationRankLabel}</dt>
          <dd>
            {selection.rank
              ? t.isolationRank
                  .replace('{n}', String(selection.rank.position))
                  .replace('{N}', String(selection.rank.total))
              : '—'}
          </dd>
        </div>
        <div className={styles.wide}>
          <dt>{t.isolationCompetitor}</dt>
          <dd>
            {competitor
              ? `${displayIsolationName(competitor, locale)} · ${displayIsolationCountry(competitor, locale)}`
              : t.isolationNoCompetitor.replace('{p}', String(percent))}
          </dd>
        </div>
        {competitor ? (
          <div className={styles.wide}>
            <dt>{t.isolationDistance}</dt>
            <dd>
              {numberFormatter.format(
                Math.round(selection.competitor!.distanceKm),
              )}{' '}
              km
            </dd>
          </div>
        ) : null}
      </dl>
      <IsolationStepChart
        holders={holders}
        populations={load.data.cities.map((item) => item.population)}
        focalPopulation={city.population}
        alpha={presentation.alpha}
        locale={locale}
      />
      <p className={styles.note}>{t.isolationCaveat}</p>
    </aside>
  );
}
