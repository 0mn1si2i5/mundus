import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import type { ModePresentation } from '../modes/useModePresentation';
import { RESHAPED_LEVELS, RESHAPED_METRICS } from './metrics';
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
  const setLevel = useAppStore((state) => state.setReshapedLevel);
  const shape = useAppStore((state) => state.reshapedShape);
  const setShape = useAppStore((state) => state.setReshapedShape);
  const replay = useAppStore((state) => state.replayReshaped);
  return (
    <section className={styles.controls} aria-label={t.reshapedControls}>
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
      <fieldset>
        <legend>{t.reshapedLevel}</legend>
        <div
          className={styles.group}
          role="radiogroup"
          aria-label={t.reshapedLevel}
        >
          {RESHAPED_LEVELS.map((level) => (
            <label key={level.id}>
              <input
                type="radio"
                name="reshaped-level"
                value={level.id}
                checked={presentation.level === level.id}
                onChange={() => setLevel(level.id)}
              />
              <span>{level.label[locale]}</span>
            </label>
          ))}
        </div>
      </fieldset>
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
    </section>
  );
}
