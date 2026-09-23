import {
  Component,
  lazy,
  Suspense,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  MODE_DEFINITIONS,
  MODE_ORDER,
  modeIndex,
  type ModeId,
} from '../features/modes/modeRegistry';
import { ModeAtlas } from '../features/modes/ModeAtlas';
import { ModeExperience } from '../features/modes/ModeExperience';
import { useGlobePresentation } from '../features/modes/useModePresentation';
import { ExhibitLobby } from '../features/modes/ExhibitLobby';
import { ModePreview } from '../features/modes/ModePreview';
import { FirstInteractionHint } from '../features/discovery/FirstInteractionHint';
import { ShareDialog } from '../features/share/ShareDialog';
import { useAppStore } from '../state/appStore';
import { useUrlState } from './useUrlState';
import { messages } from '../i18n/messages';
import styles from './App.module.css';
import { useCountrySelection } from '../features/globe/useCountrySelection';

const GlobeViewport = lazy(() =>
  import('../features/globe/GlobeViewport').then((module) => ({
    default: module.GlobeViewport,
  })),
);

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
  scope: string;
}

interface ErrorBoundaryState {
  failed: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.scope} failed`, error, info);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function App() {
  const [shareOpen, setShareOpen] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const locale = useAppStore((state) => state.locale);
  const activeMode = useAppStore((state) => state.activeMode);
  const previewMode = useAppStore((state) => state.previewMode);
  const point = useAppStore((state) => state.point);
  const hoveredCountry = useAppStore((state) => state.hoveredCountry);
  const openModePreview = useAppStore((state) => state.openModePreview);
  const closeModePreview = useAppStore((state) => state.closeModePreview);
  const enterPreviewMode = useAppStore((state) => state.enterPreviewMode);
  const exitMode = useAppStore((state) => state.exitMode);
  const navigationNotice = useAppStore((state) => state.navigationNotice);
  const dismissNavigationNotice = useAppStore(
    (state) => state.dismissNavigationNotice,
  );
  const requestCameraFocus = useAppStore((state) => state.requestCameraFocus);
  const setLocale = useAppStore((state) => state.setLocale);
  const t = messages[locale];
  const globe = useGlobePresentation();
  const atlasButtonRef = useRef<HTMLButtonElement>(null);
  const previewRestoreRef = useRef<HTMLElement | null>(null);
  // The mode the user entered through an explicit preview. A direct V2 URL
  // entry leaves this null so exiting falls back to the stable lobby heading.
  const lobbyEntryModeRef = useRef<ModeId | null>(null);
  useUrlState();
  useCountrySelection();

  function previewFromLobby(selectedMode: ModeId) {
    previewRestoreRef.current = null;
    openModePreview(selectedMode);
  }

  function previewFromAtlas(selectedMode: ModeId) {
    previewRestoreRef.current = atlasButtonRef.current;
    openModePreview(selectedMode);
    setAtlasOpen(false);
  }

  function enterFromPreview() {
    lobbyEntryModeRef.current = previewMode;
    enterPreviewMode();
    window.requestAnimationFrame(() => {
      document.getElementById('mode-title')?.focus();
    });
  }

  function returnToLobby() {
    const entryMode = lobbyEntryModeRef.current;
    lobbyEntryModeRef.current = null;
    exitMode();
    window.requestAnimationFrame(() => {
      if (entryMode) {
        const label = document.querySelector<HTMLElement>(
          `[data-lobby-mode="${entryMode}"]`,
        );
        if (label?.isConnected) {
          label.focus();
          return;
        }
      }
      document.getElementById('lobby-heading')?.focus();
    });
  }

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title =
      locale === 'zh'
        ? 'Mundus · 交互式三维地球实验室'
        : 'Mundus · Interactive terrestrial laboratory';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        locale === 'zh'
          ? 'Mundus — 用不同的观察方式重新认识地球。'
          : 'Mundus — See Earth again through different ways of observing.',
      );
  }, [locale]);

  return (
    <main className={styles.shell}>
      {navigationNotice ? (
        <div className={styles.notice} role="status">
          <p>{t.unknownModeNotice}</p>
          <button
            type="button"
            onClick={dismissNavigationNotice}
            aria-label={t.dismissNotice}
          >
            ×
          </button>
        </div>
      ) : null}
      <div className={styles.stage} data-testid="app-stage">
        <header className={styles.header} data-surname-label-obstacle>
          <div>
            <a
              className={styles.brand}
              href="./"
              aria-label="Mundus home"
              onClick={(event) => {
                if (activeMode !== null) {
                  event.preventDefault();
                  returnToLobby();
                }
              }}
            >
              MUNDUS
            </a>
            <p className={styles.eyebrow}>{t.laboratory}</p>
          </div>
          <div className={styles.actions}>
            {activeMode !== null ? (
              <button
                className={styles.textButton}
                type="button"
                onClick={returnToLobby}
              >
                {t.returnToLobby}
              </button>
            ) : null}
            <button
              ref={atlasButtonRef}
              className={styles.textButton}
              type="button"
              onClick={() => {
                setShareOpen(false);
                setAtlasOpen(true);
              }}
            >
              {t.modeAtlas}
            </button>
            <button
              className={styles.textButton}
              type="button"
              onClick={() => {
                setAtlasOpen(false);
                setShareOpen(true);
              }}
            >
              {t.share}
            </button>
            <button
              className={styles.languageButton}
              type="button"
              onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
              aria-label={t.changeLanguage}
            >
              {locale === 'zh' ? 'EN' : '中'}
            </button>
          </div>
        </header>

        {activeMode === null ? (
          <ExhibitLobby locale={locale} onSelectPreview={previewFromLobby} />
        ) : (
          <section
            key={activeMode}
            className={styles.intro}
            data-mode={activeMode}
            data-surname-label-obstacle
            aria-labelledby="mode-title"
          >
            <p className={styles.index}>
              0{modeIndex(activeMode) + 1} / 0{MODE_ORDER.length}
            </p>
            <h1 id="mode-title" tabIndex={-1}>
              {locale === 'zh'
                ? MODE_DEFINITIONS[activeMode].titlePhrases.zh.map(
                    (phrase, index) => (
                      <span key={phrase}>
                        {index > 0 ? <wbr /> : null}
                        <span className={styles.titlePhrase} data-title-phrase>
                          {phrase}
                        </span>
                      </span>
                    ),
                  )
                : MODE_DEFINITIONS[activeMode].title.en}
            </h1>
            <p>{MODE_DEFINITIONS[activeMode].question[locale]}</p>
          </section>
        )}

        <ErrorBoundary
          resetKey={activeMode ?? 'lobby'}
          scope="Globe viewport"
          fallback={
            <RecoverableFallback
              label={t.componentFailed}
              retryLabel={t.retry}
              globe
            />
          }
        >
          <Suspense fallback={<GlobeFallback label={t.loadingGlobe} />}>
            <GlobeViewport
              diagnosticResetKey={`${activeMode ?? 'lobby'}:${point.latitude},${point.longitude}`}
              fallbackLabel={t.fallback}
              contextLostLabel={t.contextLost}
              ariaLabel={t.globeLabel}
              keyboardInstructions={t.globeKeyboard}
              keyboardMovedLabel={t.globeMoved}
              keyboardZoomedLabel={t.globeZoomed}
              keyboardSelectedLabel={t.globeSelected}
              countryFills={globe.countryFills}
              showAntipodes={globe.showAntipodes}
              sunline={globe.sunline}
              antipodeRelation={globe.antipodeRelation}
              surnameMapLabels={globe.surnameMapLabels}
              surnameDisplayMode={globe.surnameDisplayMode}
            />
          </Suspense>
        </ErrorBoundary>
      </div>

      {activeMode !== null &&
      MODE_DEFINITIONS[activeMode].curation === 'archived' ? (
        <div className={styles.notice} role="status">
          <p>{t.archiveNotice}</p>
        </div>
      ) : null}

      {activeMode !== null ? (
        <ModeBoundary
          mode={activeMode}
          label={t.componentFailed}
          retry={t.retry}
          returnLabel={t.returnToLobby}
          onReturnToLobby={returnToLobby}
        >
          <ModeExperience locale={locale} onCameraFocus={requestCameraFocus} />
        </ModeBoundary>
      ) : null}

      {hoveredCountry ? (
        <p className={styles.hoverLabel}>{hoveredCountry.name}</p>
      ) : null}

      <FirstInteractionHint locale={locale} />
      {shareOpen ? (
        <ShareDialog locale={locale} onClose={() => setShareOpen(false)} />
      ) : null}
      {atlasOpen ? (
        <ModeAtlas
          locale={locale}
          activeMode={activeMode}
          onSelectMode={previewFromAtlas}
          onClose={() => setAtlasOpen(false)}
        />
      ) : null}
      {previewMode ? (
        <ModePreview
          locale={locale}
          modeId={previewMode}
          restoreFocusRef={previewRestoreRef}
          onClose={closeModePreview}
          onEnter={enterFromPreview}
        />
      ) : null}
    </main>
  );
}

function GlobeFallback({ label }: { label: string }) {
  return (
    <section className={styles.fallback} role="img" aria-label={label}>
      <div />
      <p>{label}</p>
    </section>
  );
}

function ModeBoundary({
  mode,
  label,
  retry,
  returnLabel,
  onReturnToLobby,
  children,
}: {
  mode: string;
  label: string;
  retry: string;
  returnLabel: string;
  onReturnToLobby: () => void;
  children: ReactNode;
}) {
  return (
    <ErrorBoundary
      resetKey={mode}
      scope={`${mode} experience`}
      fallback={
        <RecoverableFallback
          label={label}
          retryLabel={retry}
          returnLabel={returnLabel}
          onReturnToLobby={onReturnToLobby}
        />
      }
    >
      {children}
    </ErrorBoundary>
  );
}

function RecoverableFallback({
  label,
  retryLabel,
  returnLabel,
  onReturnToLobby,
  globe = false,
}: {
  label: string;
  retryLabel: string;
  returnLabel?: string;
  onReturnToLobby?: () => void;
  globe?: boolean;
}) {
  return (
    <section
      className={globe ? styles.recoverableGlobe : styles.recoverableMode}
      role="alert"
    >
      <p>{label}</p>
      <button type="button" onClick={() => window.location.reload()}>
        {retryLabel}
      </button>
      {!globe && returnLabel && onReturnToLobby ? (
        <button type="button" onClick={onReturnToLobby}>
          {returnLabel}
        </button>
      ) : null}
    </section>
  );
}
