import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
  type ReactNode,
} from 'react';
import { useResponsivePanel } from './useResponsivePanel';
import styles from './ModePanel.module.css';

export interface ModePanelHandle {
  collapseIfMobile: () => void;
}

interface ModePanelProps {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  expandLabel: string;
  collapseLabel: string;
  headerActions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  bodyRef?: Ref<HTMLDivElement>;
  onCollapse?: () => void;
  /** Rendered below the scrolling body, so it never covers body content. */
  footer?: ReactNode;
  children: ReactNode;
}

export const ModePanel = forwardRef<ModePanelHandle, ModePanelProps>(
  function ModePanel(
    {
      id,
      title,
      subtitle,
      expandLabel,
      collapseLabel,
      headerActions,
      className,
      bodyClassName,
      bodyRef,
      onCollapse,
      footer,
      children,
    },
    ref,
  ) {
    const { desktop, expanded, setExpanded } = useResponsivePanel();
    const toggle = useRef<HTMLButtonElement>(null);
    const wasExpanded = useRef(expanded);
    const titleId = `${id}-title`;
    const bodyId = `${id}-body`;

    const collapse = useCallback(() => setExpanded(false), [setExpanded]);

    useEffect(() => {
      if (wasExpanded.current && !expanded) {
        onCollapse?.();
        window.requestAnimationFrame(() => toggle.current?.focus());
      }
      wasExpanded.current = expanded;
    }, [expanded, onCollapse]);

    useImperativeHandle(
      ref,
      () => ({
        collapseIfMobile() {
          if (desktop) return;
          collapse();
        },
      }),
      [collapse, desktop],
    );

    return (
      <section
        className={[styles.panel, className].filter(Boolean).join(' ')}
        data-mode-panel={id}
        data-expanded={expanded}
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded && !desktop) {
            event.preventDefault();
            collapse();
          }
        }}
      >
        <div className={styles.heading}>
          <div className={styles.title}>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className={styles.headingActions}>
            <button
              ref={toggle}
              className={styles.toggle}
              type="button"
              aria-expanded={expanded}
              aria-controls={bodyId}
              aria-label={expanded ? collapseLabel : expandLabel}
              onClick={() => {
                if (expanded) collapse();
                else setExpanded(true);
              }}
            >
              <span aria-hidden="true">{expanded ? '–' : '+'}</span>
            </button>
            {headerActions}
          </div>
        </div>

        {expanded ? (
          <div
            ref={bodyRef}
            id={bodyId}
            className={[styles.body, bodyClassName].filter(Boolean).join(' ')}
          >
            {children}
          </div>
        ) : null}
        {expanded ? footer : null}
      </section>
    );
  },
);
