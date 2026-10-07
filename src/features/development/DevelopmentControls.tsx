import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import { ModePanel } from '../controls/ModePanel';
import type { CountryRef } from '../globe/countryData';
import {
  DEVELOPMENT_INDICATORS,
  developmentColor,
  valueFor,
  type DevelopmentCountry,
  type DevelopmentDataset,
  type DevelopmentIndicator,
} from './developmentData';
import {
  findStructuralContrast,
  globalIndicatorMedian,
  historicalIndicatorChange,
  STRUCTURAL_DIMENSIONS,
  type GlobalIndicatorMedian,
  type HistoricalIndicatorChange,
  type StructuralContrast,
} from './developmentEvidence';
import type { DevelopmentLoadState } from './useDevelopmentDataset';
import styles from './DevelopmentControls.module.css';

const COPY = {
  zh: {
    title: '拆解发展结构',
    loading: '正在载入 UNDP HDR 2025…',
    error: '发展数据暂时无法载入。',
    retry: '重试',
    year: '年份',
    selected: '所选国家',
    choose: '点击地球选择国家',
    missing: '该年没有数据',
    noDataRow: '该地图区域没有关联的 HDR 数据行',
    globalMedian: '全球中位数',
    evidence: '发展证据',
    observed: '个有观测值的国家和地区',
    fromMedian: '相对中位数',
    history: '历史端点变化',
    since: '自',
    indexPoints: '指数点',
    comparisonUnavailable: '无法与中位数比较',
    historyUnavailable: '此前没有可比较的观测值',
    historyCurrentMissing: '当前年份缺失，无法计算历史变化',
    historyNoEarlier: '当前年份之前没有有效观测值',
    historyInvalid: '年份无效，无法计算历史变化',
    contrast: '算法结构对照',
    contrastSummary: '相近 HDI 下，三个组成指数差异最大的规则内案例',
    contrastDistance: '结构差异值',
    contrastUnavailable:
      '当前年份没有符合规则的结构对照；未扩大范围或补齐缺失值。',
    contrastIncomplete: '所选国家该年四项数据不完整，无法计算结构对照。',
    contrastInvalid: '年份无效，无法计算结构对照。',
    contrastCaveat:
      '这是规则选出的差异案例，不代表典型性、相似社会条件或因果关系。',
    hdiGap: 'HDI 差值',
    legend: '指数值',
    noData: '缺失',
    table: '表格视图',
    tableNavigation: '发展数据表滚动区',
    closeTable: '关闭表格',
    country: '国家或地区',
    value: '指数',
    delta: '相对中位数',
    historicalChange: '历史端点变化',
    method: '数据与方法',
    methodText:
      'HDI 为 UNDP 报告值；健康、教育和收入按 HDR 2025 技术说明派生。全球中位数对当前年份全部有效国家和地区等权计算。相对中位数与历史变化均为绝对指数点差，历史端点取当前年份之前最早的有效观测。缺失值不插值也不转为零。',
    contrastMethod:
      '结构对照要求双方同年四项数据完整且 HDI 差不超过 0.020；选择健康、教育和收入绝对差之和最大的候选，以 ISO3 处理并列。比较不说明典型性或因果。',
    source: 'UNDP HDR 2025 来源页',
    license: 'CC BY 3.0 IGO 许可',
    attribution:
      '来源：UNDP《2025 人类发展报告》；由 Mundus 转换并标注派生指标。',
    scope: '195 个国家和地区 · 1990–2023',
    continueToContrast: '继续查看算法结构对照',
    expand: '展开发展控件',
    collapse: '收起发展控件',
    indicators: {
      hdi: '综合 HDI',
      health: '健康',
      education: '教育',
      income: '收入',
    },
  },
  en: {
    title: 'Unpack development',
    loading: 'Loading UNDP HDR 2025…',
    error: 'Development data is unavailable.',
    retry: 'Retry',
    year: 'Year',
    selected: 'Selected country',
    choose: 'Click the globe to select a country',
    missing: 'No observation for this year',
    noDataRow: 'This map region has no linked HDR data row',
    globalMedian: 'Global median',
    evidence: 'Development evidence',
    observed: 'observed countries and territories',
    fromMedian: 'From median',
    history: 'Historical endpoint change',
    since: 'Since',
    indexPoints: 'index points',
    comparisonUnavailable: 'Median comparison unavailable',
    historyUnavailable: 'No earlier comparable observation',
    historyCurrentMissing:
      'The current year is missing; historical change is unavailable',
    historyNoEarlier: 'No valid observation exists before the current year',
    historyInvalid: 'The year is invalid; historical change is unavailable',
    contrast: 'Algorithmic structural contrast',
    contrastSummary:
      'Rule-selected case with the largest component difference at similar HDI',
    contrastDistance: 'Structure distance',
    contrastUnavailable:
      'No contrast meets the rule for this year; the window was not widened and missing values were not imputed.',
    contrastIncomplete:
      'The selected country lacks a complete four-index row for this year, so no contrast can be calculated.',
    contrastInvalid: 'The year is invalid, so no contrast can be calculated.',
    contrastCaveat:
      'This rule-selected contrast is not evidence of typicality, similar social conditions, or causation.',
    hdiGap: 'HDI gap',
    legend: 'Index value',
    noData: 'Missing',
    table: 'Table view',
    tableNavigation: 'Development data table scroll area',
    closeTable: 'Close table',
    country: 'Country or territory',
    value: 'Index',
    delta: 'From median',
    historicalChange: 'Historical endpoint change',
    method: 'Data and method',
    methodText:
      'HDI is reported by UNDP; health, education and income are derived using HDR 2025 Technical Note 1. The global median gives equal weight to every valid country or territory observation. Median distance and history are absolute index-point differences; history uses the earliest valid observation before the selected year. Missing values are neither imputed nor converted to zero.',
    contrastMethod:
      'A contrast requires complete same-year data and an HDI gap no greater than 0.020. The candidate with the largest sum of absolute health, education and income gaps is selected, with ISO3 resolving ties. The comparison does not establish typicality or causation.',
    source: 'UNDP HDR 2025 source',
    license: 'CC BY 3.0 IGO license',
    attribution:
      'Source: UNDP Human Development Report 2025; transformed by Mundus with derived indicators identified.',
    scope: '195 countries and territories · 1990–2023',
    continueToContrast: 'Continue to algorithmic structural contrast',
    expand: 'Expand development controls',
    collapse: 'Collapse development controls',
    indicators: {
      hdi: 'Overall HDI',
      health: 'Health',
      education: 'Education',
      income: 'Income',
    },
  },
} as const;

const LEGEND_VALUES = [0.3, 0.475, 0.625, 0.75, 0.85, 0.95] as const;

export function DevelopmentControls({
  locale,
  loadState,
  selectedCountry,
}: {
  locale: Locale;
  loadState: DevelopmentLoadState;
  selectedCountry: CountryRef | null;
}) {
  const indicator = useAppStore((state) => state.developmentIndicator);
  const year = useAppStore((state) => state.developmentYear);
  const selectIndicator = useAppStore(
    (state) => state.selectDevelopmentIndicator,
  );
  const selectYear = useAppStore((state) => state.selectDevelopmentYear);
  const [tableOpen, setTableOpen] = useState(false);
  const tableButton = useRef<HTMLButtonElement>(null);
  const panelBody = useRef<HTMLDivElement>(null);
  const [continuationSlot, setContinuationSlot] =
    useState<HTMLDivElement | null>(null);
  const copy = COPY[locale];
  const selectedCountryId = selectedCountry?.countryId ?? null;
  const evidence = useMemo(() => {
    if (loadState.status !== 'ready') return null;
    const country = selectedCountryId
      ? (loadState.data.countriesById.get(selectedCountryId) ?? null)
      : null;
    const selectedValue = country ? valueFor(country, indicator, year) : null;
    return {
      country,
      selectedValue,
      benchmark: globalIndicatorMedian(loadState.data, indicator, year),
      history: country
        ? historicalIndicatorChange(loadState.data, country, indicator, year)
        : null,
      contrast: country
        ? findStructuralContrast(loadState.data, country, year)
        : null,
    };
  }, [loadState, selectedCountryId, indicator, year]);
  const country = evidence?.country ?? null;
  const selectedValue = evidence?.selectedValue ?? null;
  const benchmark = evidence?.benchmark ?? null;
  const history = evidence?.history ?? null;
  const contrast = evidence?.contrast ?? null;
  const medianDifference =
    selectedValue !== null && benchmark?.status === 'available'
      ? selectedValue - benchmark.median
      : null;

  return (
    <>
      <ModePanel
        id="development-controls"
        className={styles.developmentPanel}
        bodyClassName={styles.panelBody}
        bodyRef={panelBody}
        title={copy.title}
        subtitle={copy.scope}
        expandLabel={copy.expand}
        collapseLabel={copy.collapse}
        onCollapse={() => setTableOpen(false)}
        footer={
          <div ref={setContinuationSlot} className={styles.continuationSlot} />
        }
      >
        <>
          {loadState.status === 'loading' ? (
            <p className={styles.status} role="status">
              {copy.loading}
            </p>
          ) : null}
          {loadState.status === 'error' ? (
            <div className={styles.errorStatus} role="alert">
              <p className={styles.status}>{copy.error}</p>
              <button type="button" onClick={loadState.retry}>
                {copy.retry}
              </button>
            </div>
          ) : null}
          {loadState.status === 'ready' ? (
            <>
              <div className={styles.indicators} aria-label={copy.title}>
                {DEVELOPMENT_INDICATORS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-active={item === indicator}
                    aria-pressed={item === indicator}
                    onClick={() => selectIndicator(item)}
                  >
                    {copy.indicators[item]}
                  </button>
                ))}
              </div>

              <label className={styles.timeline}>
                <span>{copy.year}</span>
                <strong>{year}</strong>
                <input
                  type="range"
                  min="1990"
                  max="2023"
                  step="1"
                  value={year}
                  onChange={(event) => selectYear(Number(event.target.value))}
                />
              </label>

              <div className={styles.selection}>
                <span>{copy.selected}</span>
                <strong>{selectedCountry?.name ?? copy.choose}</strong>
                {selectedCountry ? (
                  <em>
                    {country
                      ? (selectedValue?.toFixed(3) ?? copy.missing)
                      : copy.noDataRow}
                  </em>
                ) : null}
              </div>

              <DevelopmentEvidenceView
                locale={locale}
                country={country}
                indicator={indicator}
                year={year}
                value={selectedValue}
                benchmark={benchmark}
                medianDifference={medianDifference}
                history={history}
                contrast={contrast}
                scrollBodyRef={panelBody}
                continuationSlot={continuationSlot}
              />

              <div className={styles.legend} aria-label={copy.legend}>
                <span>{copy.legend}</span>
                <div>
                  {LEGEND_VALUES.map((value) => (
                    <i
                      key={value}
                      role="img"
                      aria-label={developmentBinLabel(locale, value)}
                      style={{ backgroundColor: developmentColor(value) }}
                    />
                  ))}
                </div>
                <small>
                  0 <b>{copy.noData}</b> 1
                </small>
              </div>

              <div className={styles.footerActions}>
                <button
                  ref={tableButton}
                  type="button"
                  aria-expanded={tableOpen}
                  onClick={() => setTableOpen((current) => !current)}
                >
                  {tableOpen ? copy.closeTable : copy.table}
                </button>
                <details>
                  <summary>{copy.method}</summary>
                  <p>{copy.methodText}</p>
                  <p>{copy.contrastMethod}</p>
                  <p>{copy.attribution}</p>
                  <a
                    href="https://hdr.undp.org/data-center/documentation-and-downloads"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {copy.source} ↗
                  </a>
                  {' · '}
                  <a
                    href="https://creativecommons.org/licenses/by/3.0/igo/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {copy.license} ↗
                  </a>
                </details>
              </div>
            </>
          ) : null}
        </>
      </ModePanel>

      {tableOpen && loadState.status === 'ready' ? (
        <DevelopmentTable
          locale={locale}
          dataset={loadState.data}
          indicator={indicator}
          year={year}
          benchmark={benchmark}
          selectedCountryId={selectedCountry?.countryId ?? null}
          onClose={() => {
            setTableOpen(false);
            window.requestAnimationFrame(() => tableButton.current?.focus());
          }}
        />
      ) : null}
    </>
  );
}

function developmentBinLabel(locale: Locale, value: number) {
  const upperBound =
    value < 0.4
      ? 0.4
      : value < 0.55
        ? 0.55
        : value < 0.7
          ? 0.7
          : value < 0.8
            ? 0.8
            : value < 0.9
              ? 0.9
              : 1;
  return locale === 'zh'
    ? `指数区间，上限 ${upperBound.toFixed(2)}`
    : `Index bin, upper bound ${upperBound.toFixed(2)}`;
}

function DevelopmentEvidenceView({
  locale,
  country,
  indicator,
  year,
  value,
  benchmark,
  medianDifference,
  history,
  contrast,
  scrollBodyRef,
  continuationSlot,
}: {
  locale: Locale;
  country: DevelopmentCountry | null;
  indicator: DevelopmentIndicator;
  year: number;
  value: number | null;
  benchmark: GlobalIndicatorMedian | null;
  medianDifference: number | null;
  history: HistoricalIndicatorChange | null;
  contrast: StructuralContrast | null;
  scrollBodyRef: RefObject<HTMLDivElement | null>;
  continuationSlot: HTMLElement | null;
}) {
  const copy = COPY[locale];
  const contrastElement = useRef<HTMLElement>(null);
  const contrastHeading = useRef<HTMLHeadingElement>(null);
  const continuationVisibleRef = useRef(false);
  const [continuationVisible, setContinuationVisible] = useState(false);
  const liveSummary = country
    ? [
        country.name,
        copy.indicators[indicator],
        String(year),
        value?.toFixed(3) ?? copy.missing,
        medianDifference === null
          ? copy.comparisonUnavailable
          : `${copy.fromMedian} ${formatSigned(medianDifference)} ${copy.indexPoints}`,
        history?.status === 'available'
          ? `${history.baselineYear}–${history.currentYear} ${copy.history} ${formatSigned(history.change)} ${copy.indexPoints}`
          : historyUnavailableText(locale, history),
      ].join(' · ')
    : '';

  useEffect(() => {
    const body = scrollBodyRef.current;
    if (!body) return;
    let frame = 0;

    const updateContinuation = () => {
      frame = 0;
      const target = contrastElement.current;
      const bodyRect = body.getBoundingClientRect();
      const targetRect = target?.getBoundingClientRect();
      const nextVisible = Boolean(
        targetRect && targetRect.top >= bodyRect.bottom - 1,
      );
      if (nextVisible === continuationVisibleRef.current) return;
      continuationVisibleRef.current = nextVisible;
      setContinuationVisible(nextVisible);
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateContinuation);
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(body);
    for (const child of body.children) resizeObserver.observe(child);
    body.addEventListener('scroll', scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      body.removeEventListener('scroll', scheduleUpdate);
      resizeObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [contrast, scrollBodyRef]);

  const continuationButton = (
    <button
      className={styles.continuation}
      type="button"
      data-visible={continuationVisible}
      aria-hidden={!continuationVisible}
      tabIndex={continuationVisible ? 0 : -1}
      onClick={() => {
        contrastHeading.current?.focus({ preventScroll: true });
        contrastElement.current?.scrollIntoView({ block: 'start' });
      }}
    >
      {copy.continueToContrast}
      <span aria-hidden="true">↓</span>
    </button>
  );

  return (
    <section className={styles.evidence} aria-label={copy.evidence}>
      <output className={styles.visuallyHidden} aria-live="polite">
        {liveSummary}
      </output>
      <div className={styles.evidenceGrid}>
        <div>
          <span>{copy.globalMedian}</span>
          <strong>
            {benchmark?.status === 'available'
              ? benchmark.median.toFixed(3)
              : '—'}
          </strong>
          <small>
            {benchmark?.status === 'available'
              ? `${benchmark.observedCount} ${copy.observed}`
              : copy.missing}
          </small>
        </div>
        <div>
          <span>{copy.fromMedian}</span>
          <strong>
            {medianDifference === null
              ? '—'
              : `${formatSigned(medianDifference)} ${copy.indexPoints}`}
          </strong>
          <small>
            {medianDifference === null ? copy.comparisonUnavailable : year}
          </small>
        </div>
        <div>
          <span>{copy.history}</span>
          <strong>
            {history?.status === 'available'
              ? `${formatSigned(history.change)} ${copy.indexPoints}`
              : '—'}
          </strong>
          <small>
            {history?.status === 'available'
              ? `${history.baselineYear}–${history.currentYear}`
              : historyUnavailableText(locale, history)}
          </small>
        </div>
      </div>

      {continuationSlot
        ? createPortal(continuationButton, continuationSlot)
        : null}

      {country && contrast ? (
        <article ref={contrastElement} className={styles.contrast}>
          <h3 ref={contrastHeading} tabIndex={-1}>
            {copy.contrast}
          </h3>
          {contrast.status === 'available' ? (
            <>
              <strong>{contrast.country.name}</strong>
              <small>{copy.contrastSummary}</small>
              <table className={styles.contrastGrid}>
                <thead>
                  <tr>
                    <th />
                    <th scope="col">{country.name}</th>
                    <th scope="col">{contrast.country.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {STRUCTURAL_DIMENSIONS.map((dimension) => (
                    <tr key={dimension}>
                      <th scope="row">{copy.indicators[dimension]}</th>
                      <td>
                        {contrast.dimensions[dimension].selected.toFixed(3)}
                      </td>
                      <td>
                        {contrast.dimensions[dimension].contrast.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <em>
                {copy.contrastDistance} {contrast.structuralDistance.toFixed(3)}
              </em>
              <em>
                {copy.hdiGap} {contrast.hdiDifference.toFixed(3)}
              </em>
              <p>{copy.contrastCaveat}</p>
            </>
          ) : (
            <p>{contrastUnavailableText(locale, contrast)}</p>
          )}
        </article>
      ) : null}
    </section>
  );
}

function DevelopmentTable({
  locale,
  dataset,
  indicator,
  year,
  benchmark,
  selectedCountryId,
  onClose,
}: {
  locale: Locale;
  dataset: DevelopmentDataset;
  indicator: DevelopmentIndicator;
  year: number;
  benchmark: GlobalIndicatorMedian | null;
  selectedCountryId: string | null;
  onClose: () => void;
}) {
  const copy = COPY[locale];
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const rows = useMemo(
    () =>
      dataset.countries
        .map((country) => ({
          country,
          value: valueFor(country, indicator, year),
          history: historicalIndicatorChange(dataset, country, indicator, year),
        }))
        .sort((a, b) =>
          a.country.name < b.country.name
            ? -1
            : a.country.name > b.country.name
              ? 1
              : a.country.iso3 < b.country.iso3
                ? -1
                : a.country.iso3 > b.country.iso3
                  ? 1
                  : 0,
        ),
    [dataset, indicator, year],
  );

  useEffect(() => {
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    closeButton.current?.focus();
    return () => root?.removeAttribute('inert');
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = panel.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = controls?.[0];
    const last = controls?.[controls.length - 1];
    if (!first || !last) return;
    if (
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  return createPortal(
    <aside
      ref={panel}
      className={styles.tablePanel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="development-table-title"
      onKeyDown={handleKeyDown}
    >
      <div className={styles.tableHeading}>
        <div>
          <span id="development-table-title">{copy.table}</span>
          <strong>
            {copy.indicators[indicator]} · {year}
          </strong>
        </div>
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label={copy.closeTable}
        >
          ×
        </button>
      </div>
      <div
        className={styles.tableScroll}
        role="region"
        aria-label={copy.tableNavigation}
        tabIndex={0}
        onKeyDown={(event) => {
          const element = event.currentTarget;
          const verticalStep = Math.max(80, element.clientHeight * 0.8);
          const horizontalStep = Math.max(40, element.clientWidth * 0.25);
          switch (event.key) {
            case 'PageDown':
              event.preventDefault();
              element.scrollTop += verticalStep;
              break;
            case 'PageUp':
              event.preventDefault();
              element.scrollTop -= verticalStep;
              break;
            case 'Home':
              event.preventDefault();
              element.scrollTop = 0;
              break;
            case 'End':
              event.preventDefault();
              element.scrollTop = element.scrollHeight;
              break;
            case 'ArrowRight':
              event.preventDefault();
              element.scrollLeft += horizontalStep;
              break;
            case 'ArrowLeft':
              event.preventDefault();
              element.scrollLeft -= horizontalStep;
              break;
          }
        }}
      >
        <table>
          <caption>
            {copy.indicators[indicator]} · {year} · {copy.globalMedian}{' '}
            {benchmark?.status === 'available'
              ? `${benchmark.median.toFixed(3)} · n=${benchmark.observedCount}`
              : '—'}
          </caption>
          <thead>
            <tr>
              <th scope="col">{copy.country}</th>
              <th scope="col">{copy.value}</th>
              <th scope="col">{copy.delta}</th>
              <th scope="col">{copy.historicalChange}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ country, value, history }) => (
              <tr
                key={country.iso3}
                data-selected={country.countryId === selectedCountryId}
              >
                <td>{country.name}</td>
                <td>
                  {value === null ? (
                    <MissingValue label={copy.missing} />
                  ) : (
                    value.toFixed(3)
                  )}
                </td>
                <td>
                  {value !== null && benchmark?.status === 'available' ? (
                    formatSigned(value - benchmark.median)
                  ) : (
                    <MissingValue label={copy.comparisonUnavailable} />
                  )}
                </td>
                <td>
                  {history.status === 'available' ? (
                    `${formatSigned(history.change)} · ${history.baselineYear}–${history.currentYear}`
                  ) : (
                    <MissingValue
                      label={historyUnavailableText(locale, history)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>,
    document.body,
  );
}

function formatSigned(value: number): string {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return `${normalized >= 0 ? '+' : '−'}${Math.abs(normalized).toFixed(3)}`;
}

function MissingValue({ label }: { label: string }) {
  return (
    <span title={label}>
      <span aria-hidden="true">—</span>
      <span className={styles.visuallyHidden}>{label}</span>
    </span>
  );
}

function historyUnavailableText(
  locale: Locale,
  history: HistoricalIndicatorChange | null,
): string {
  const copy = COPY[locale];
  if (!history || history.status === 'available')
    return copy.historyUnavailable;
  switch (history.reason) {
    case 'current-missing':
      return copy.historyCurrentMissing;
    case 'no-earlier-observation':
      return copy.historyNoEarlier;
    case 'invalid-year':
      return copy.historyInvalid;
  }
}

function contrastUnavailableText(
  locale: Locale,
  contrast: Exclude<StructuralContrast, { status: 'available' }>,
): string {
  const copy = COPY[locale];
  switch (contrast.reason) {
    case 'selected-incomplete':
      return copy.contrastIncomplete;
    case 'invalid-year':
      return copy.contrastInvalid;
    case 'no-candidate':
      return copy.contrastUnavailable;
  }
}
