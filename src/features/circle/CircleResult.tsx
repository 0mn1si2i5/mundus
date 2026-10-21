import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import type { ModePresentation } from '../modes/useModePresentation';
import { displayCountryName } from '../globe/countryNames';
import baseStyles from '../modes/ModeResult.module.css';
import styles from './Circle.module.css';
import {
  CIRCLE_COPY,
  formatCirclePopulation,
  formatCircleRadius,
  formatCircleShare,
} from './circleCopy';
import { CIRCLE_ROUGH_BELOW_KM } from './circleRadius';

export function CircleResult({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: Extract<ModePresentation, { id: 'circle' }>;
}) {
  const t = messages[locale];
  const copy = CIRCLE_COPY[locale];
  const { data, selection } = presentation;
  return (
    <aside
      className={`${baseStyles.result} ${styles.result}`}
      aria-live="polite"
      aria-label={copy.result}
      data-testid="circle-result"
    >
      <div className={baseStyles.endpoint}>
        <span className={baseStyles.label}>{t.selectedPoint}</span>
        <em className={baseStyles.place}>
          {presentation.selectedCountry
            ? displayCountryName(presentation.selectedCountry, locale)
            : t.openOcean}
        </em>
        <span className={baseStyles.coords}>
          {presentation.point.latitude.toFixed(2)}°,{' '}
          {presentation.point.longitude.toFixed(2)}°
        </span>
      </div>
      {data.status === 'error' ? (
        <div className={baseStyles.status} role="status">
          <p>{copy.unavailable}</p>
          <button
            className={baseStyles.retry}
            type="button"
            onClick={data.retry}
          >
            {copy.retry}
          </button>
        </div>
      ) : !selection || data.status !== 'ready' ? (
        <p className={baseStyles.status} role="status">
          {copy.loading}
        </p>
      ) : (
        <>
          <p className={styles.finding} data-testid="circle-finding">
            {presentation.radiusKm === null
              ? copy.halfFinding.replace(
                  '{r}',
                  formatCircleRadius(selection.halfRadiusKm, locale),
                )
              : copy.customFinding
                  .replace(
                    '{r}',
                    formatCircleRadius(selection.radiusKm, locale),
                  )
                  .replace(
                    '{p}',
                    formatCirclePopulation(selection.population, locale),
                  )
                  .replace('{s}', formatCircleShare(selection.share, locale))}
          </p>
          <dl className={baseStyles.facts}>
            <div>
              <dt>{copy.halfRadius}</dt>
              <dd data-testid="circle-half-radius">
                {formatCircleRadius(selection.halfRadiusKm, locale)}
              </dd>
            </div>
            <div>
              <dt>{copy.people}</dt>
              <dd>{formatCirclePopulation(selection.population, locale)}</dd>
            </div>
            <div>
              <dt>{copy.share}</dt>
              <dd>{formatCircleShare(selection.share, locale)}</dd>
            </div>
            <div>
              <dt>{copy.comparison}</dt>
              <dd>
                {selection.timesSmallest < 1.005
                  ? copy.smallestHere
                  : copy.timesSmallest.replace(
                      '{x}',
                      selection.timesSmallest.toFixed(1),
                    )}
              </dd>
            </div>
          </dl>
          <table className={styles.milestones}>
            <caption>{copy.milestones}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.milestoneShare}</th>
                <th scope="col">{copy.milestoneRadius}</th>
              </tr>
            </thead>
            <tbody>
              {selection.milestones.map((milestone) => (
                <tr
                  key={milestone.share}
                  aria-current={milestone.share === 0.5 ? 'true' : undefined}
                >
                  <th scope="row">
                    {formatCircleShare(milestone.share, locale)}
                  </th>
                  <td>{formatCircleRadius(milestone.radiusKm, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selection.radiusKm < CIRCLE_ROUGH_BELOW_KM ? (
            <p className={baseStyles.note} data-testid="circle-rough">
              {copy.rough}
            </p>
          ) : null}
          <p className={baseStyles.note}>
            {copy.note.replace('{year}', String(data.data.year))}
          </p>
        </>
      )}
    </aside>
  );
}
