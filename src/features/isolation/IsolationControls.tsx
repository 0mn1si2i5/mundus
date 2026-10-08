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
  const t = messages[locale];
  const numberFormatter = new Intl.NumberFormat(
    locale === 'zh' ? 'zh-CN' : 'en-US',
  );
  const ranking = presentation.ranking;
  const selectedCityIndex = presentation.selection?.cityIndex;
  return (
    <ModePanel
      id="isolation-controls"
      title={t.isolationPanelTitle}
      subtitle={t.isolationSliderValue
        .replace('{a}', alpha.toFixed(2))
        .replace('{p}', String(Math.round(alpha * 100)))}
      expandLabel={t.isolationExpand}
      collapseLabel={t.isolationCollapse}
    >
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
    </ModePanel>
  );
}
