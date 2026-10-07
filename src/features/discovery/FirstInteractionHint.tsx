import { useEffect, useState } from 'react';
import type { Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import styles from './FirstInteractionHint.module.css';

const STORAGE_KEY = 'mundus:discovery-hint:v1';

const COPY = {
  zh: {
    text: '拖拽旋转，滚动或双指缩放，点击一点查看结果。',
    close: '关闭操作提示',
  },
  en: {
    text: 'Drag to rotate, scroll or pinch to zoom, then select a point.',
    close: 'Dismiss interaction hint',
  },
} as const;

function wasDismissed() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

function persistDismissal() {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'dismissed');
  } catch {
    // Storage is optional; the current session still dismisses the hint.
  }
}

export function FirstInteractionHint({
  locale,
  inLobby,
}: {
  locale: Locale;
  inLobby: boolean;
}) {
  const completed = useAppStore((state) => state.hasMeaningfulInteraction);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const copy = COPY[locale];

  useEffect(() => {
    if (!completed || dismissed) return;
    persistDismissal();
  }, [completed, dismissed]);

  if (dismissed || completed) return null;

  return (
    <aside
      className={styles.hint}
      data-context={inLobby ? 'lobby' : 'mode'}
      data-testid="first-interaction-hint"
      data-surname-label-obstacle
    >
      <p>{copy.text}</p>
      <button
        type="button"
        aria-label={copy.close}
        onClick={() => {
          persistDismissal();
          setDismissed(true);
        }}
      >
        ×
      </button>
    </aside>
  );
}
