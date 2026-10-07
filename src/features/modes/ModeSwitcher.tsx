import { useEffect, useId, useRef, useState } from 'react';
import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import { MODE_DEFINITIONS, modesInTier, type ModeId } from './modeRegistry';
import styles from './ModeSwitcher.module.css';

/**
 * Header navigation: the primary observations as tabs, the rest behind a
 * "More" disclosure. Switching keeps the selected place (cameraPolicy).
 */
export function ModeSwitcher({
  locale,
  activeMode,
  onSelect,
}: {
  locale: Locale;
  activeMode: ModeId | null;
  onSelect: (mode: ModeId) => void;
}) {
  const t = messages[locale];
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const more = modesInTier('more');
  const activeMore =
    activeMode && MODE_DEFINITIONS[activeMode].tier === 'more'
      ? MODE_DEFINITIONS[activeMode]
      : null;

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  function choose(mode: ModeId) {
    setOpen(false);
    onSelect(mode);
  }

  return (
    <nav className={styles.switcher} aria-label={t.modes}>
      {modesInTier('primary').map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={styles.tab}
          data-mode-tab={mode.id}
          aria-current={activeMode === mode.id ? 'page' : undefined}
          onClick={() => choose(mode.id)}
        >
          {mode.title[locale]}
        </button>
      ))}
      <div
        ref={container}
        className={styles.more}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            setOpen(false);
            toggle.current?.focus();
          }
        }}
      >
        <button
          ref={toggle}
          type="button"
          className={styles.tab}
          aria-expanded={open}
          aria-controls={menuId}
          aria-current={activeMore ? 'page' : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          {activeMore ? activeMore.title[locale] : t.moreModes}
          <span className={styles.caret} aria-hidden="true">
            ▾
          </span>
        </button>
        {open ? (
          <ul id={menuId} className={styles.menu} aria-label={t.moreModes}>
            {more.map((mode) => (
              <li key={mode.id}>
                <button
                  type="button"
                  data-mode-tab={mode.id}
                  aria-current={activeMode === mode.id ? 'page' : undefined}
                  onClick={() => choose(mode.id)}
                >
                  <strong>{mode.title[locale]}</strong>
                  <span>{mode.summary[locale]}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </nav>
  );
}
