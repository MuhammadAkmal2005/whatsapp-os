/**
 * The dashboard, at a glance.
 *
 * The figures belong to a made-up shop and the frame says so — they illustrate what the
 * screen reports, and are not a claim about anyone's results. The one number that is a real
 * product behaviour rather than a sample is the split between AI-handled and passed-to-a-person
 * conversations, because that ratio is what the product actually measures.
 *
 * The chart is a hand-built SVG rather than the dashboard's charting library: a sparkline is
 * twelve coordinates, and pulling a client-side chart runtime onto a marketing page to draw
 * one would cost more than the whole rest of the section.
 */

const METRICS = [
  { label: 'Conversations', value: '384', trend: 'this month' },
  { label: 'Handled end to end by AI', value: '71%', trend: 'no person needed' },
  { label: 'Orders created in chat', value: '46', trend: 'this month' },
] as const;

// Fourteen daily conversation counts. Fixed values, so server and client render identically.
const SERIES = [18, 22, 19, 27, 24, 31, 29, 34, 30, 38, 35, 41, 39, 46] as const;

const CHART_WIDTH = 300;
const CHART_HEIGHT = 72;

function buildPoints(): string {
  const max = Math.max(...SERIES);
  const min = Math.min(...SERIES);
  const span = max - min || 1;
  const step = CHART_WIDTH / (SERIES.length - 1);

  return SERIES.map((value, index) => {
    const x = index * step;
    // Four pixels of headroom top and bottom so the stroke is never clipped by the viewBox.
    const y = CHART_HEIGHT - 4 - ((value - min) / span) * (CHART_HEIGHT - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function AnalyticsMock() {
  const points = buildPoints();

  return (
    <div className="flex flex-col gap-4 bg-card p-4">
      <dl className="grid grid-cols-3 gap-3">
        {METRICS.map((metric) => (
          <div key={metric.label} className="flex flex-col gap-0.5">
            <dd className="text-lg font-semibold tabular-nums leading-none text-foreground">
              {metric.value}
            </dd>
            <dt className="text-3xs font-medium leading-tight text-foreground">{metric.label}</dt>
            <p className="text-3xs leading-tight text-muted-foreground">{metric.trend}</p>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-sunken p-3">
        <p className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
          Conversations · last 14 days
        </p>
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-16 w-full"
          preserveAspectRatio="none"
          aria-hidden
          focusable="false"
        >
          <polyline
            points={`0,${CHART_HEIGHT} ${points} ${CHART_WIDTH},${CHART_HEIGHT}`}
            fill="hsl(var(--primary) / 0.16)"
            stroke="none"
          />
          <polyline
            points={points}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            // The viewBox is stretched, so a uniform stroke would be drawn thicker
            // vertically than horizontally without this.
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}
