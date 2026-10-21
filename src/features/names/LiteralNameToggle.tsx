import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import {
  DEFAULT_LITERAL_NAME_LABEL,
  type LiteralNameLabel,
} from './literalNameWordmark';
import styles from './LiteralNameToggle.module.css';

const LABELS: readonly LiteralNameLabel[] = ['literal', 'local'];

/** Chooses whether globe wordmarks show literal meanings or local names. */
export function LiteralNameToggle({ locale }: { locale: Locale }) {
  const selected =
    useAppStore((state) => state.namesLabel) ?? DEFAULT_LITERAL_NAME_LABEL;
  const setLabel = useAppStore((state) => state.setNamesLabel);
  const t = messages[locale];
  const text: Record<LiteralNameLabel, string> = {
    literal: t.namesLabelLiteral,
    local: t.namesLabelLocal,
  };

  return (
    <div
      className={styles.segmented}
      role="radiogroup"
      aria-label={t.namesLabelMode}
    >
      {LABELS.map((label) => (
        <button
          key={label}
          className={styles.option}
          type="button"
          role="radio"
          aria-checked={selected === label}
          onClick={() => setLabel(label)}
        >
          {text[label]}
        </button>
      ))}
    </div>
  );
}
