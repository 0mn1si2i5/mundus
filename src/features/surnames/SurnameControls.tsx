import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import {
  DEFAULT_SURNAME_DISPLAY_MODE,
  type SurnameDisplayMode,
} from '../../state/urlState';
import { useAppStore } from '../../state/appStore';
import { ModePanel } from '../controls/ModePanel';
import styles from './SurnameControls.module.css';

const DISPLAY_MODES: readonly SurnameDisplayMode[] = [
  'local',
  'latin',
  'chinese',
];

export function SurnameControls({ locale }: { locale: Locale }) {
  const selectedMode =
    useAppStore((state) => state.surnameDisplayMode) ??
    DEFAULT_SURNAME_DISPLAY_MODE;
  const setDisplayMode = useAppStore((state) => state.setSurnameDisplayMode);
  const t = messages[locale];
  const labels: Record<SurnameDisplayMode, string> = {
    local: t.surnameDisplayLocal,
    latin: t.surnameDisplayLatin,
    chinese: t.surnameDisplayChinese,
  };

  return (
    <ModePanel
      id="surname-controls"
      className={styles.panel}
      title={t.surnameDisplayMode}
      subtitle={labels[selectedMode]}
      expandLabel={t.surnameDisplayExpand}
      collapseLabel={t.surnameDisplayCollapse}
    >
      <div
        className={styles.segmented}
        role="radiogroup"
        aria-label={t.surnameDisplayMode}
      >
        {DISPLAY_MODES.map((mode) => (
          <button
            key={mode}
            className={styles.option}
            type="button"
            role="radio"
            aria-checked={selectedMode === mode}
            data-active={selectedMode === mode}
            onClick={() => setDisplayMode(mode)}
          >
            {labels[mode]}
          </button>
        ))}
      </div>
    </ModePanel>
  );
}
