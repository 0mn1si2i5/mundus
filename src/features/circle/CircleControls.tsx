import type { Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import { ModePanel } from '../controls/ModePanel';
import type { ModePresentation } from '../modes/useModePresentation';
import styles from './Circle.module.css';
import {
  CIRCLE_COPY,
  formatCirclePoint,
  formatCircleRadius,
  formatCircleShare,
} from './circleCopy';
import {
  CIRCLE_SLIDER_STEPS,
  radiusToSlider,
  sliderToRadius,
} from './circleRadius';

export function CircleControls({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: Extract<ModePresentation, { id: 'circle' }>;
}) {
  const setRadius = useAppStore((state) => state.setCircleRadiusKm);
  const selectCircleHalfAt = useAppStore((state) => state.selectCircleHalfAt);
  const copy = CIRCLE_COPY[locale];
  const { selection, data } = presentation;
  const radiusKm = selection?.radiusKm ?? presentation.radiusKm;
  const smallest = data.status === 'ready' ? data.data.smallest : null;
  const radiusText =
    radiusKm === null ? '—' : formatCircleRadius(radiusKm, locale);
  return (
    <ModePanel
      id="circle-controls"
      title={copy.panelTitle}
      subtitle={presentation.radiusKm === null ? copy.panelHalf : radiusText}
      expandLabel={copy.expand}
      collapseLabel={copy.collapse}
    >
      <label className={styles.slider}>
        <span>{copy.sliderLabel}</span>
        <strong data-testid="circle-radius-value">{radiusText}</strong>
        <input
          aria-label={copy.sliderLabel}
          type="range"
          min="0"
          max={CIRCLE_SLIDER_STEPS}
          step="1"
          disabled={radiusKm === null}
          value={radiusKm === null ? 0 : radiusToSlider(radiusKm)}
          aria-valuetext={
            radiusKm === null || !selection
              ? undefined
              : copy.sliderValueText
                  .replace('{r}', radiusText)
                  .replace('{s}', formatCircleShare(selection.share, locale))
          }
          onChange={(event) =>
            setRadius(sliderToRadius(Number(event.target.value)))
          }
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={presentation.radiusKm === null}
          onClick={() => setRadius(null)}
        >
          {copy.resetHalf}
        </button>
        <button
          type="button"
          disabled={!smallest}
          onClick={() => {
            if (!smallest) return;
            selectCircleHalfAt(smallest.point);
          }}
        >
          {copy.goSmallest}
        </button>
      </div>
      {smallest ? (
        <p className={styles.panelNote}>
          {copy.smallestNote
            .replace('{point}', formatCirclePoint(smallest.point, locale))
            .replace('{r}', formatCircleRadius(smallest.radiusKm, locale))}
        </p>
      ) : null}
    </ModePanel>
  );
}
