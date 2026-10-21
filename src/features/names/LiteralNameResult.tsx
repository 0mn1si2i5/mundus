import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import { COUNTRY_NAMES, displayCountryName } from '../globe/countryNames';
import type { ModePresentation } from '../modes/useModePresentation';
import modeStyles from '../modes/ModeResult.module.css';
import { factbookEntryUrl } from './literalNameData';
import type {
  ChineseNameKind,
  LiteralNameConfidence,
} from './literalNameTypes';
import { resolveLiteralNameWordmark } from './literalNameWordmark';
import { LiteralNameToggle } from './LiteralNameToggle';
import styles from './LiteralNameResult.module.css';

type NamesPresentation = Extract<ModePresentation, { id: 'names' }>;

export function LiteralNameResult({
  locale,
  presentation,
}: {
  locale: Locale;
  presentation: NamesPresentation;
}) {
  const t = messages[locale];
  const country = presentation.selectedCountry;
  const loadState = presentation.data;
  const record =
    country && loadState.status === 'ready'
      ? (loadState.data.byId.get(country.countryId) ?? null)
      : null;
  const wordmark = record
    ? resolveLiteralNameWordmark(record, presentation.label, locale)
    : null;
  const confidenceText: Record<LiteralNameConfidence, string> = {
    established: t.namesConfidenceEstablished,
    likely: t.namesConfidenceLikely,
    disputed: t.namesConfidenceDisputed,
    unknown: t.namesConfidenceUnknown,
  };
  const kindText: Record<ChineseNameKind, string> = {
    phonetic: t.namesChineseKindPhonetic,
    semantic: t.namesChineseKindSemantic,
    mixed: t.namesChineseKindMixed,
    native: t.namesChineseKindNative,
    abbreviated: t.namesChineseKindAbbreviated,
  };
  const chineseName = record ? COUNTRY_NAMES[record.id]?.zh : undefined;

  return (
    <aside
      className={`${modeStyles.result} ${styles.result}`}
      aria-live="polite"
      aria-label={t.namesResult}
      data-testid="names-result"
      data-surname-label-obstacle
    >
      <LiteralNameToggle locale={locale} />
      <div className={modeStyles.endpoint}>
        <span className={modeStyles.label}>{t.selectedCountryLabel}</span>
        <em className={modeStyles.place}>
          {country
            ? displayCountryName(country, locale)
            : t.surnameChooseCountry}
        </em>
      </div>
      {record ? (
        <div className={modeStyles.wordmark}>
          <span className={modeStyles.visuallyHidden}>{t.namesWordmark}</span>
          {wordmark ? (
            <strong
              lang={
                presentation.label === 'local'
                  ? record.lang
                  : locale === 'zh'
                    ? 'zh-CN'
                    : 'en'
              }
              data-testid="names-wordmark"
            >
              {wordmark.value}
            </strong>
          ) : (
            <strong data-testid="names-wordmark">
              {t.namesUnknownLiteral}
            </strong>
          )}
        </div>
      ) : null}
      {!country ? (
        <p className={modeStyles.status}>{t.namesSelectOnGlobe}</p>
      ) : loadState.status === 'loading' ? (
        <p className={modeStyles.status}>{t.namesLoading}</p>
      ) : loadState.status === 'error' ? (
        <div className={modeStyles.status}>
          <p>{t.namesUnavailable}</p>
          <button
            className={modeStyles.retry}
            type="button"
            onClick={loadState.retry}
          >
            {t.namesRetry}
          </button>
        </div>
      ) : record && loadState.status === 'ready' ? (
        <div className={modeStyles.surnameFacts}>
          <p
            className={`${modeStyles.badge} ${styles.badge}`}
            data-confidence={record.confidence}
          >
            {t.namesConfidence} · {confidenceText[record.confidence]}
            {record.basis === 'local' ? ` · ${t.namesBasisLocal}` : ''}
          </p>
          <dl className={modeStyles.facts}>
            <div>
              <dt>{t.namesLiteral}</dt>
              <dd>
                {record.confidence === 'unknown'
                  ? t.namesUnknownLiteral
                  : record.literal[locale]}
              </dd>
            </div>
            <div>
              <dt>{t.namesLocal}</dt>
              <dd className={styles.local} lang={record.lang}>
                {record.local}
              </dd>
            </div>
            <div className={modeStyles.wide}>
              <dt>{t.namesFrom}</dt>
              <dd>{record.from[locale]}</dd>
            </div>
            {chineseName ? (
              <div className={modeStyles.wide}>
                <dt>{t.namesChineseName}</dt>
                <dd>
                  <span lang="zh-CN">{chineseName}</span> ·{' '}
                  {kindText[record.zhKind]}
                </dd>
              </div>
            ) : null}
          </dl>
          {record.note ? (
            <p className={styles.prose}>{record.note[locale]}</p>
          ) : null}
          {record.zhNote ? (
            <p className={styles.prose}>{record.zhNote[locale]}</p>
          ) : null}
          <p className={modeStyles.sources}>
            <span>{t.namesSources}</span>
            {record.factbook ? (
              <a
                href={factbookEntryUrl(loadState.data, record.factbook)}
                rel="noreferrer"
                target="_blank"
              >
                {t.namesFactbookSource} ↗
              </a>
            ) : null}
            {(record.sources ?? []).map((source) => (
              <a
                href={source.url}
                key={source.url}
                rel="noreferrer"
                target="_blank"
                title={
                  source.checked === 'search-summary'
                    ? t.namesSearchSummary
                    : undefined
                }
              >
                {source.title} ↗
              </a>
            ))}
          </p>
          <p className={modeStyles.note}>{t.namesCaveat}</p>
        </div>
      ) : (
        <p className={modeStyles.status}>{t.namesNoRecord}</p>
      )}
    </aside>
  );
}
