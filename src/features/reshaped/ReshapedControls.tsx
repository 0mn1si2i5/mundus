import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import { ModePanel } from '../controls/ModePanel';
import type { ModePresentation } from '../modes/useModePresentation';
import { RESHAPED_METRICS } from './metrics';
import styles from './ReshapedControls.module.css';

export function ReshapedControls({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: Extract<ModePresentation, { id: 'reshaped' }>;
}) {
  const t = messages[locale];
  const setMetric = useAppStore((state) => state.setReshapedMetric);
  const shape = useAppStore((state) => state.reshapedShape);
  const setShape = useAppStore((state) => state.setReshapedShape);
  const replay = useAppStore((state) => state.replayReshaped);
  return (
    <ModePanel
      id="reshaped-controls"
      title={t.reshapedControls}
      expandLabel={t.reshapedExpand}
      collapseLabel={t.reshapedCollapse}
      bodyClassName={styles.controls}
    >
      <fieldset>
        <legend>{t.reshapedMetric}</legend>
        <div
          className={styles.group}
          role="radiogroup"
          aria-label={t.reshapedMetric}
        >
          {RESHAPED_METRICS.map((metric) => (
            <label key={metric.id}>
              <input
                type="radio"
                name="reshaped-metric"
                value={metric.id}
                checked={presentation.metric === metric.id}
                onChange={() => setMetric(metric.id)}
              />
              <span>{metric.shortLabel[locale]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className={styles.paddingLegend}>
        <span className={styles.paddingSample} aria-hidden="true" />
        {t.reshapedPaddingLegend}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          aria-pressed={shape === 'true'}
          onClick={() => setShape('true')}
        >
          {t.reshapedTrueShape}
        </button>
        <button
          type="button"
          aria-pressed={shape === 'reshaped'}
          onClick={() => setShape('reshaped')}
        >
          {t.reshapedMorphedShape}
        </button>
        <button type="button" onClick={replay}>
          {t.reshapedReplay}
        </button>
      </div>
    </ModePanel>
  );
}
