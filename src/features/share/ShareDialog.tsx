import { useRef, useState } from 'react';
import { Dialog } from '../controls/Dialog';
import type { Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import { createShareUrl } from './shareUrl';
import styles from './ShareDialog.module.css';

const COPY = {
  zh: {
    title: '分享这一视角',
    description:
      '分享链接会编码并恢复当前所选位置与观察方式；复制前请确认你愿意分享这一位置。',
    lobbyDescription:
      '分享链接会编码并恢复当前所选位置；复制前请确认你愿意分享这一位置。',
    sunlineDescription:
      '分享链接会编码并恢复当前所选位置与观察方式，并固定当前显示的 UTC 时间；复制前请确认你愿意分享这一位置与时间。',
    fieldLabel: '分享链接',
    copy: '复制分享链接',
    close: '关闭',
    copied: '链接已复制',
    failed: '无法自动复制，请手动复制上方链接。',
  },
  en: {
    title: 'Share this view',
    description:
      'The share link encodes and restores the selected location and observation mode. Before copying, confirm that you are willing to share this location.',
    lobbyDescription:
      'The share link encodes and restores the selected location. Before copying, confirm that you are willing to share this location.',
    sunlineDescription:
      'The share link encodes and restores the selected location and observation mode, and fixes the displayed UTC time. Before copying, confirm that you are willing to share this location and time.',
    fieldLabel: 'Share link',
    copy: 'Copy share link',
    close: 'Close',
    copied: 'Link copied',
    failed: 'Automatic copy failed. Manually copy the link above.',
  },
} as const;

export function ShareDialog({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [snapshot] = useState(() => {
    const state = useAppStore.getState();
    const shareableState = {
      activeMode: state.activeMode,
      point: state.point,
      sunlineTimeMs: state.sunlineTimeMs,
      sunlineClockMode: state.sunlineClockMode,
      surnameDisplayMode: state.surnameDisplayMode,
      isolationAlpha: state.isolationAlpha,
      isolationView: state.isolationView,
    };
    return {
      activeMode: state.activeMode,
      url: createShareUrl(window.location.href, shareableState),
    };
  });
  const [status, setStatus] = useState('');
  const linkField = useRef<HTMLInputElement>(null);
  const copy = COPY[locale];
  const description =
    snapshot.activeMode === null
      ? copy.lobbyDescription
      : snapshot.activeMode === 'sunline'
        ? copy.sunlineDescription
        : copy.description;

  function selectLink() {
    linkField.current?.select();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(snapshot.url);
      setStatus(copy.copied);
    } catch {
      setStatus(copy.failed);
      linkField.current?.focus();
      selectLink();
    }
  }

  return (
    <Dialog
      titleId="share-title"
      descriptionId="share-description"
      eyebrow="URL / POSITION"
      title={copy.title}
      description={description}
      closeLabel={copy.close}
      onClose={onClose}
    >
      <input
        ref={linkField}
        className={styles.linkField}
        aria-label={copy.fieldLabel}
        readOnly
        value={snapshot.url}
        onFocus={selectLink}
      />
      <div className={styles.actions}>
        <button type="button" onClick={copyLink}>
          {copy.copy}
        </button>
      </div>
      <output aria-live="polite">{status}</output>
    </Dialog>
  );
}
