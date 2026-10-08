import type { RecordHolder } from './isolationMetric';
import { ALPHA_MAX, ALPHA_MIN, competitorAt } from './isolationMetric';
import type { Locale } from '../../i18n/messages';
import { messages } from '../../i18n/messages';

export function IsolationStepChart({
  holders,
  populations,
  focalPopulation,
  alpha,
  locale,
}: {
  holders: readonly RecordHolder[];
  populations: readonly number[];
  focalPopulation: number;
  alpha: number;
  locale: Locale;
}) {
  const t = messages[locale];
  const maxDistance = Math.max(
    1,
    ...holders.map((holder) => holder.distanceKm),
  );
  const width = 240;
  const height = 96;
  const padding = { left: 8, right: 8, top: 8, bottom: 18 };
  const x = (value: number) =>
    padding.left +
    ((value - ALPHA_MIN) / (ALPHA_MAX - ALPHA_MIN)) *
      (width - padding.left - padding.right);
  const y = (distance: number) =>
    height -
    padding.bottom -
    (distance / maxDistance) * (height - padding.top - padding.bottom);
  const steps = holders.flatMap((holder, index) => {
    const previous =
      index === 0
        ? ALPHA_MIN
        : Math.max(
            ALPHA_MIN,
            populations[holders[index - 1]!.index]! / focalPopulation,
          );
    const next = Math.min(
      ALPHA_MAX,
      populations[holder.index]! / focalPopulation,
    );
    return [{ holder, start: previous, end: next }];
  });
  const current = competitorAt(holders, populations, focalPopulation, alpha);
  const ariaLabel = current
    ? t.isolationChartAria
        .replace('{a}', alpha.toFixed(2))
        .replace(
          '{d}',
          new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(
            Math.round(current.distanceKm),
          ),
        )
    : t.isolationNoCompetitor.replace('{p}', String(Math.round(alpha * 100)));
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label={ariaLabel}
    >
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={height - padding.bottom}
        y2={height - padding.bottom}
        stroke="currentColor"
        opacity="0.25"
      />
      {steps.map(({ holder, start, end }) => (
        <line
          key={`${holder.index}-${holder.distanceKm}`}
          x1={x(start)}
          x2={x(end)}
          y1={y(holder.distanceKm)}
          y2={y(holder.distanceKm)}
          stroke="#b88746"
          strokeWidth="2"
        />
      ))}
      {steps.slice(1).map(({ holder, start }, index) => (
        <line
          key={`jump-${holder.index}`}
          x1={x(start)}
          x2={x(start)}
          y1={y(steps[index]!.holder.distanceKm)}
          y2={y(holder.distanceKm)}
          stroke="#b88746"
          strokeWidth="2"
        />
      ))}
      <line
        x1={x(alpha)}
        x2={x(alpha)}
        y1={padding.top}
        y2={height - padding.bottom}
        stroke="#79bba9"
        strokeWidth="1.5"
      />
      <text x={padding.left} y={height - 4} fontSize="9" fill="currentColor">
        0.10
      </text>
      <text
        x={width - padding.right}
        y={height - 4}
        textAnchor="end"
        fontSize="9"
        fill="currentColor"
      >
        1.00
      </text>
    </svg>
  );
}
