import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import { ModePanel } from '../controls/ModePanel';
import type { ModePresentation } from '../modes/useModePresentation';
import { displayIsolationName } from './isolationData';
import styles from './IsolationControls.module.css';

export function IsolationControls({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: Extract<ModePresentation, { id: 'isolation' }>;
}) {
  const alpha = useAppStore((state) => state.isolationAlpha);
  const setAlpha = useAppStore((state) => state.setIsolationAlpha);
  const selectPoint = useAppStore((state) => state.selectPoint);
  const view = useAppStore((state) => state.isolationView);
  const setView = useAppStore((state) => state.setIsolationView);
  const t = messages[locale];
  const numberFormatter = new Intl.NumberFormat(
    locale === 'zh' ? 'zh-CN' : 'en-US',
  );
  const ranking = presentation.ranking;
  const selectedCityIndex = presentation.selection?.cityIndex;
  return (
    <ModePanel
      className={styles.isolationPanel}
      bodyClassName={styles.isolationBody}
      id="isolation-controls"
      title={t.isolationPanelTitle}
      subtitle={t.isolationSliderValue
        .replace('{a}', alpha.toFixed(2))
        .replace('{p}', String(Math.round(alpha * 100)))}
      expandLabel={t.isolationExpand}
      collapseLabel={t.isolationCollapse}
    >
      <div
        className={styles.viewSwitch}
        role="group"
        aria-label={t.isolationViewLabel}
      >
        <button
          type="button"
          aria-pressed={view === 'city'}
          onClick={() => setView('city')}
        >
          {t.isolationCityView}
        </button>
        <button
          type="button"
          aria-pressed={view === 'field'}
          onClick={() => setView('field')}
        >
          {t.isolationFieldView}
        </button>
      </div>
      <label className={styles.slider}>
        <span>{t.isolationSliderLabel}</span>
        <strong>{alpha.toFixed(2)}</strong>
        <input
          aria-label={t.isolationSliderLabel}
          type="range"
          min="0.1"
          max="1"
          step="0.01"
          value={alpha}
          onChange={(event) => setAlpha(Number(event.target.value))}
        />
      </label>
      <div
        className={`${styles.details} ${view === 'field' ? styles.fieldDetails : ''}`}
      >
        {view === 'field' ? (
          <div className={styles.fieldNote}>
            <p>{t.isolationFieldRule}</p>
            {presentation.field.status === 'loading' ||
            presentation.field.status === 'idle' ? (
              <p role="status">{t.isolationFieldLoading}</p>
            ) : null}
            {presentation.field.status === 'error' ? (
              <p role="status">
                {t.isolationFieldError}{' '}
                <button type="button" onClick={presentation.field.retry}>
                  {t.isolationRetry}
                </button>
              </p>
            ) : null}
            {presentation.field.status === 'ready' ? (
              <p>
                {t.isolationFieldCount.replace(
                  '{n}',
                  String(presentation.field.sites.length),
                )}
              </p>
            ) : null}
          </div>
        ) : null}
        <h3 className={styles.heading}>{t.isolationTopList}</h3>
        <ol className={styles.list}>
          {ranking.slice(0, 10).map((entry, index) => (
            <li key={entry.city.id}>
              <button
                type="button"
                aria-current={
                  selectedCityIndex !== undefined &&
                  presentation.dataset.status === 'ready' &&
                  presentation.dataset.data.cities[selectedCityIndex]?.id ===
                    entry.city.id
                    ? 'true'
                    : undefined
                }
                onClick={() => selectPoint(entry.city.point)}
              >
                {t.isolationTopListItem
                  .replace('{n}', String(index + 1))
                  .replace('{city}', displayIsolationName(entry.city, locale))
                  .replace(
                    '{d}',
                    numberFormatter.format(Math.round(entry.distanceKm)),
                  )}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </ModePanel>
  );
}
