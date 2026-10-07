import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Dialog.module.css';

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal shell: portals to <body>, makes the app inert, traps focus,
 * closes on Escape or a backdrop press, and restores focus on close.
 */
export function Dialog({
  titleId,
  descriptionId = `${titleId}-description`,
  title,
  eyebrow,
  description,
  closeLabel,
  onClose,
  wide = false,
  children,
}: {
  titleId: string;
  descriptionId?: string;
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  wide?: boolean;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const restoreFocus = document.activeElement;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    closeButton.current?.focus();
    return () => {
      root?.removeAttribute('inert');
      if (restoreFocus instanceof HTMLElement) restoreFocus.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = controls?.[0];
    const last = controls?.[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <section
        ref={dialog}
        className={styles.dialog}
        data-wide={wide}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <button
          ref={closeButton}
          className={styles.close}
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <span aria-hidden="true">×</span>
        </button>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h2 id={titleId}>{title}</h2>
        {description ? (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        ) : null}
        {children}
      </section>
    </div>,
    document.body,
  );
}
