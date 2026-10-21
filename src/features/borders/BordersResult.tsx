import type { Locale } from '../../i18n/messages';
import {
  useChooseDestination,
  useFocusTripOnEnter,
} from './useChooseDestination';
import { displayCountryName } from '../globe/countryNames';
import modeStyles from '../modes/ModeResult.module.css';
import type { ModePresentation } from '../modes/useModePresentation';
import { BORDERS_COPY, crossingsText, fill, unitName } from './bordersCopy';
import { CROSSING_BANDS, ROUTE_COLORS } from './bordersPalette';
import { mostNeighbours, type FixedLink } from './landBorders';
import styles from './BordersResult.module.css';

type BordersPresentation = Extract<ModePresentation, { id: 'borders' }>;

export function BordersResult({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: BordersPresentation;
}) {
  const copy = BORDERS_COPY[locale];
  const setDestination = useChooseDestination();
  useFocusTripOnEnter();
  const { selectedCountry, destination, data, reach, route } = presentation;
  const start = selectedCountry
    ? displayCountryName(selectedCountry, locale)
    : null;
  const name = (countryId: string) => unitName(countryId, locale);
  const linkName = (link: FixedLink) => link.name[locale];

  let finding: string;
  if (data.status === 'error') finding = copy.unavailable;
  else if (data.status !== 'ready') finding = copy.loading;
  else if (!selectedCountry || !start) finding = copy.chooseStart;
  else if (route?.status === 'same') finding = copy.same;
  else if (route?.status === 'unreachable')
    finding = fill(copy.unreachable, {
      start,
      destination: name(destination!),
    });
  else if (route?.status === 'route')
    finding = fill(copy.route, {
      start,
      destination: name(destination!),
      crossings: crossingsText(locale, route.crossings),
    });
  else if (!reach || reach.crossings.size === 0)
    finding = fill(
      reach && reach.neighbours.length > 0
        ? copy.overviewNeighboursOnly
        : copy.isolated,
      { start, neighbours: reach?.neighbours.length ?? 0 },
    );
  else
    finding = fill(
      reach.neighbours.length > 0 ? copy.overview : copy.overviewLinkedOnly,
      {
        start,
        neighbours: reach.neighbours.length,
        reach: reach.crossings.size,
        max: crossingsText(locale, reach.maxCrossings),
      },
    );

  return (
    <aside
      className={`${modeStyles.result} ${styles.result}`}
      aria-label={copy.result}
      data-testid="borders-result"
      data-route-status={route?.status ?? (reach ? 'reach' : 'none')}
      data-route-crossings={
        route?.status === 'route' ? route.crossings : undefined
      }
    >
      <div className={modeStyles.endpoint}>
        <span className={modeStyles.label}>{copy.start}</span>
        <em className={modeStyles.place}>{start ?? '—'}</em>
      </div>
      <p className={styles.finding} aria-live="polite">
        {finding}
      </p>
      {data.status === 'error' ? (
        <button className={modeStyles.retry} type="button" onClick={data.retry}>
          {copy.retry}
        </button>
      ) : null}

      {route?.status === 'route' ? (
        <section aria-label={copy.routeLabel}>
          <span className={modeStyles.label}>{copy.routeLabel}</span>
          <ol className={styles.route} data-testid="borders-route">
            {route.steps.map((step, index) => {
              const notes = [
                ...step.linksWithin.map((link) =>
                  fill(copy.via, { link: linkName(link) }),
                ),
                ...(step.detached ? [copy.detached] : []),
              ];
              return (
                <li
                  key={`${step.countryId}-${index}`}
                  data-country-id={step.countryId}
                >
                  {step.arrivedVia ? (
                    <span className={styles.crossing}>
                      {fill(copy.via, { link: linkName(step.arrivedVia) })}
                    </span>
                  ) : null}
                  <span
                    className={styles.swatch}
                    style={{
                      background:
                        index === 0
                          ? 'var(--borders-start)'
                          : index === route.steps.length - 1
                            ? ROUTE_COLORS.destination
                            : ROUTE_COLORS.through,
                    }}
                    aria-hidden="true"
                  />
                  <span>{name(step.countryId)}</span>
                  {notes.length > 0 ? (
                    <small>{notes.join(locale === 'zh' ? '，' : '; ')}</small>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {!route && reach ? (
        <>
          <dl className={modeStyles.facts}>
            <div>
              <dt>{copy.neighboursLabel}</dt>
              <dd>{reach.neighbours.length}</dd>
            </div>
            <div>
              <dt>{copy.reachLabel}</dt>
              <dd>{reach.crossings.size}</dd>
            </div>
            {reach.farthest.length > 0 ? (
              <div className={modeStyles.wide}>
                <dt>{copy.farthestLabel}</dt>
                <dd className={styles.farthest}>
                  <span>{crossingsText(locale, reach.maxCrossings)}</span>
                  {reach.farthest.map((countryId) => (
                    <button
                      key={countryId}
                      type="button"
                      className={styles.chip}
                      aria-label={fill(copy.showRoute, {
                        name: name(countryId),
                      })}
                      onClick={() => setDestination(countryId)}
                    >
                      {name(countryId)}
                    </button>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
          {reach.neighbours.length > 0 ? (
            <section aria-label={copy.neighboursLabel}>
              <span className={modeStyles.label}>{copy.neighboursLabel}</span>
              <ul className={styles.chips}>
                {reach.neighbours.map((countryId) => (
                  <li key={countryId}>
                    <button
                      type="button"
                      className={styles.chip}
                      aria-label={fill(copy.setDestination, {
                        name: name(countryId),
                      })}
                      onClick={() => setDestination(countryId)}
                    >
                      {name(countryId)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {reach.linked.length > 0 ? (
            <section aria-label={copy.linkedLabel}>
              <span className={modeStyles.label}>{copy.linkedLabel}</span>
              <ul className={styles.chips}>
                {reach.linked.map(({ countryId, link }) => (
                  <li key={`${countryId}-${link.id}`}>
                    <button
                      type="button"
                      className={styles.chip}
                      aria-label={fill(copy.setDestination, {
                        name: name(countryId),
                      })}
                      onClick={() => setDestination(countryId)}
                    >
                      {name(countryId)}
                    </button>
                    <small>{linkName(link)}</small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {reach.crossings.size > 0 ? (
            <figure className={styles.legend}>
              <figcaption>{copy.legend}</figcaption>
              <ul>
                {CROSSING_BANDS.map(({ min, max, color }) => (
                  <li key={color}>
                    <span
                      className={styles.swatch}
                      style={{ background: color }}
                      aria-hidden="true"
                    />
                    {min === max
                      ? min
                      : max === Infinity
                        ? `${min}+`
                        : `${min}–${max}`}
                  </li>
                ))}
                <li>
                  <span
                    className={`${styles.swatch} ${styles.unreachable}`}
                    aria-hidden="true"
                  />
                  {copy.legendUnreachable}
                </li>
              </ul>
            </figure>
          ) : null}
        </>
      ) : null}

      {data.status === 'ready' ? (
        <details className={styles.ranking}>
          <summary>{copy.mostNeighbours}</summary>
          <ol>
            {mostNeighbours(data.data, 5).map(({ countryId, count }) => (
              <li key={countryId}>
                <span>{name(countryId)}</span>
                <span>{fill(copy.count, { n: count })}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <p className={modeStyles.note}>{copy.note}</p>
    </aside>
  );
}
