import { useId, useMemo } from 'react';
import type { Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import { ModePanel } from '../controls/ModePanel';
import { getCountryLabelAnchorForId } from '../globe/countryLabel';
import { getCountryDataset } from '../globe/countryData';
import { COUNTRY_NAMES } from '../globe/countryNames';
import { BORDERS_COPY } from './bordersCopy';
import {
  greatCircleMidpoint,
  useChooseDestination,
} from './useChooseDestination';
import styles from './BordersControls.module.css';

export function BordersControls({ locale }: { locale: Locale }) {
  const copy = BORDERS_COPY[locale];
  const destination = useAppStore((state) => state.bordersDestination);
  const start = useAppStore((state) => state.selectedCountry);
  const selectBordersTrip = useAppStore((state) => state.selectBordersTrip);
  const requestCameraFocus = useAppStore((state) => state.requestCameraFocus);
  const chooseDestination = useChooseDestination();
  const fieldId = useId();
  const options = useMemo(() => {
    const collator = new Intl.Collator(locale === 'zh' ? 'zh-CN' : 'en');
    return Object.entries(COUNTRY_NAMES)
      .map(([countryId, name]) => ({ countryId, label: name[locale] }))
      .sort((a, b) => collator.compare(a.label, b.label));
  }, [locale]);
  const anchor = destination ? getCountryLabelAnchorForId(destination) : null;
  // The start follows globe picking, which has no units below low detail.
  const destinationAnchor =
    anchor &&
    getCountryDataset().findCountry(anchor.point)?.countryId === destination
      ? anchor
      : null;

  function swap() {
    if (!destination || !destinationAnchor) return;
    const previousStart = start?.countryId ?? null;
    const previousAnchor = previousStart
      ? getCountryLabelAnchorForId(previousStart)
      : null;
    selectBordersTrip(destinationAnchor.point, previousStart);
    if (previousAnchor) {
      requestCameraFocus(
        greatCircleMidpoint(destinationAnchor.point, previousAnchor.point),
      );
    }
  }

  return (
    <ModePanel
      id="borders-controls"
      title={copy.controlsTitle}
      subtitle={copy.controlsSubtitle}
      expandLabel={copy.expand}
      collapseLabel={copy.collapse}
    >
      <div className={styles.controls} aria-label={copy.controls} role="group">
        <div className={styles.field}>
          <label htmlFor={fieldId}>{copy.destinationField}</label>
          <select
            id={fieldId}
            value={destination ?? ''}
            onChange={(event) => chooseDestination(event.target.value || null)}
          >
            <option value="">{copy.noDestination}</option>
            {options.map(({ countryId, label }) => (
              <option key={countryId} value={countryId}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={swap}
            disabled={!destination || !destinationAnchor || !start}
          >
            {copy.swap}
          </button>
          <button
            type="button"
            onClick={() => chooseDestination(null)}
            disabled={!destination}
          >
            {copy.clear}
          </button>
        </div>
      </div>
    </ModePanel>
  );
}
