import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import type { ModePresentation } from '../modes/useModePresentation';
import { formatReshapedValue, RESHAPED_METRICS } from './metrics';
import type { ReshapedUnit } from './reshapedData';
import styles from './ReshapedResult.module.css';

export function ReshapedResult({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: Extract<ModePresentation, { id: 'reshaped' }>;
}) {
  const t = messages[locale];
  const selectPoint = useAppStore((state) => state.selectPoint);
  const setSelectedUnitId = useAppStore(
    (state) => state.setReshapedSelectedUnitId,
  );
  const unavailable = useAppStore((state) => state.reshapedGraphicsUnavailable);
  const morphState = useAppStore((state) => state.reshapedMorphState);
  const { data, selectedUnit, selectedValue, ranking, metric } = presentation;
  if (data.status === 'loading' || data.status === 'idle')
    return (
      <aside className={styles.result} role="status">
        <p>{t.reshapedLoading}</p>
      </aside>
    );
  if (data.status === 'error')
    return (
      <aside className={styles.result} role="status">
        <p>{t.reshapedUnavailable}</p>
        <button type="button" onClick={data.retry}>
          {t.reshapedRetry}
        </button>
      </aside>
    );
  const definition = RESHAPED_METRICS.find((m) => m.id === metric)!;
  const unitName = (unit: ReshapedUnit) => unit.name[locale] ?? unit.name.en;
  const countryName = (id: string) => {
    const country = data.data?.unitsById.get(id);
    return country ? unitName(country) : id;
  };
  const selectionUnavailable =
    !selectedUnit && !data.data?.ids && presentation.level === 'admin1';
  const selectedName = selectedUnit
    ? unitName(selectedUnit)
    : selectionUnavailable
      ? t.reshapedUnresolvedUnit
      : t.openOcean;
  const raw = selectedValue?.values[metric] ?? null;
  const share = selectedValue?.worldShare[metric] ?? null;
  const ratio = selectedValue?.areaRatio[metric] ?? null;
  const finding = !selectedUnit
    ? selectionUnavailable
      ? t.reshapedSelectionUnavailable
      : t.reshapedOcean
    : selectedUnit.excluded
      ? t.reshapedExcluded
      : raw === null
        ? t.reshapedMissingShape
        : t.reshapedFinding
            .replace('{name}', selectedName)
            .replace('{metric}', definition.title[locale])
            .replace('{share}', share === null ? '—' : (share * 100).toFixed(1))
            .replace('{ratio}', ratio === null ? '—' : ratio.toFixed(1));
  return (
    <aside
      className={styles.result}
      aria-label={t.reshapedResult}
      data-testid="reshaped-result"
    >
      <div className={styles.endpoint}>
        <span className={styles.label}>{t.reshapedSelected}</span>
        <strong>{selectedName}</strong>
        {selectedUnit?.level === 'admin1' ? (
          <small>{countryName(selectedUnit.parentCountryId)}</small>
        ) : null}
      </div>
      <p className={styles.finding} aria-live="polite">
        {finding}
      </p>
      {selectedUnit ? (
        <dl className={styles.facts}>
          <div>
            <dt>{t.reshapedValue}</dt>
            <dd>
              {formatReshapedValue(raw, metric, locale)}
              <small> {definition.unit[locale]}</small>
            </dd>
          </div>
          <div>
            <dt>{t.reshapedShare}</dt>
            <dd>
              {share === null
                ? t.reshapedMissing
                : `${(share * 100).toFixed(1)}%`}
            </dd>
          </div>
          <div>
            <dt>{t.reshapedAreaRatio}</dt>
            <dd>
              {ratio === null ? t.reshapedMissing : `${ratio.toFixed(1)}×`}
            </dd>
          </div>
          <div>
            <dt>{t.reshapedYear}</dt>
            <dd>2020</dd>
          </div>
          <div>
            <dt>{t.reshapedSource}</dt>
            <dd>{definition.sourceName}</dd>
          </div>
        </dl>
      ) : null}
      {data.data?.graphicsUnavailable || unavailable ? (
        <p role="status">{t.reshapedDeviceUnavailable}</p>
      ) : null}
      {metric === 'lights' ? (
        <p className={styles.note}>{t.reshapedLightsCaveat}</p>
      ) : null}
      <div className={styles.rankings} aria-label={t.reshapedTopList}>
        <h3>{t.reshapedTopList}</h3>
        <ol>
          {ranking.map((row) => {
            const unit = data.data?.unitsById.get(row.id);
            return unit ? (
              <li key={row.id}>
                <button
                  type="button"
                  disabled={!unit.representativePoint}
                  aria-current={
                    selectedUnit?.id === unit.id ? 'true' : undefined
                  }
                  onClick={() => {
                    if (!unit.representativePoint) return;
                    selectPoint(unit.representativePoint);
                    setSelectedUnitId(unit.id);
                  }}
                >
                  {unitName(unit)} ·{' '}
                  {row.worldShare[metric] === null
                    ? t.reshapedMissing
                    : `${(row.worldShare[metric]! * 100).toFixed(1)}%`}
                </button>
              </li>
            ) : null;
          })}
        </ol>
      </div>
      <span className={styles.live} aria-live="polite">
        {morphState === 'settled' &&
        !data.data?.graphicsUnavailable &&
        !unavailable
          ? t.reshapedSettled.replace('{metric}', definition.shortLabel[locale])
          : ''}
      </span>
    </aside>
  );
}
