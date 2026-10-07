import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';
import { modesInTier, type ModeId } from './modeRegistry';
import styles from './ExhibitLobby.module.css';

/**
 * The opening screen: the globe turns behind two primary observations, with
 * the remaining ones offered as quieter links.
 */
export function ExhibitLobby({
  locale,
  onEnter,
}: {
  locale: Locale;
  onEnter: (mode: ModeId) => void;
}) {
  const t = messages[locale];
  const more = modesInTier('more');

  return (
    <section
      className={styles.lobby}
      aria-labelledby="lobby-heading"
      data-surname-label-obstacle
    >
      <header className={styles.heading}>
        <h1 id="lobby-heading" tabIndex={-1}>
          {t.lobbyTitle}
        </h1>
        <p>{t.lobbyDescription}</p>
      </header>
      <ul className={styles.primary} aria-label={t.modes}>
        {modesInTier('primary').map((mode, index) => (
          <li key={mode.id}>
            <button
              type="button"
              className={styles.card}
              data-lobby-mode={mode.id}
              onClick={() => onEnter(mode.id)}
            >
              <span className={styles.index}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className={styles.title}>{mode.title[locale]}</span>
              <span className={styles.question}>{mode.question[locale]}</span>
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.more}>
        <span id="lobby-more">{t.moreModes}</span>
        <ul aria-labelledby="lobby-more">
          {more.map((mode) => (
            <li key={mode.id}>
              <button
                type="button"
                data-lobby-mode={mode.id}
                onClick={() => onEnter(mode.id)}
              >
                {mode.title[locale]}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
