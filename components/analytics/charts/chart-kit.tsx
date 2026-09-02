'use client';

import { ResponsiveContainer } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

/**
 * Shared chart chrome.
 *
 * The three analytics charts were three separate inventions: each had its own copy of the date
 * formatter, its own hard-coded hex palette, and a tooltip with a white background that was
 * unreadable in dark mode. This module is the one place that decides what a chart in this
 * product looks like.
 *
 * Series colours are read through CSS custom properties rather than baked in, so a chart
 * follows the theme. `var()` resolves inside SVG presentation attributes because those
 * attributes are parsed as CSS values, which is what lets a `stroke` follow `--chart-1`
 * without a re-render on theme change.
 */

/** A series in the legend. `color` is a resolved CSS colour, normally from `chartColor`. */
export type ChartSeries = {
  label: string;
  color: string;
};

/** The nth series colour, following the active theme. */
export function chartColor(index: 1 | 2 | 3 | 4 | 5): string {
  return `hsl(var(--chart-${index}))`;
}

export const CHART_GRID_COLOR = 'hsl(var(--chart-grid))';
export const CHART_AXIS_COLOR = 'hsl(var(--chart-axis))';

/**
 * Axis defaults. No tick marks and no axis line — the horizontal grid rules already carry the
 * scale, and a chart with a full box of rules and ticks around it spends most of its ink on
 * chrome rather than on data.
 */
export const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  stroke: CHART_AXIS_COLOR,
  tick: { fontSize: 11, fill: CHART_AXIS_COLOR },
  tickMargin: 8,
} as const;

/** Grid defaults: horizontal hairlines only, solid rather than dashed. */
export const GRID_PROPS = {
  vertical: false,
  stroke: CHART_GRID_COLOR,
  strokeOpacity: 1,
} as const;

/** Plot insets. The right inset leaves room for the last x-axis label to sit fully inside. */
export const CHART_MARGIN = { top: 8, right: 8, left: -8, bottom: 0 } as const;

/**
 * A `YYYY-MM-DD` bucket as a short axis label.
 *
 * Parsed field by field rather than by `new Date(dateStr)`, which reads a bare date as UTC and
 * so shows the previous day for anyone west of Greenwich.
 */
export function formatChartDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return dateStr;

  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return dateStr;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type TooltipPayloadItem = {
  dataKey?: string | number;
  name?: string;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
};

type ChartTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadItem[];
  /**
   * How to render each series' value, keyed by `dataKey`. Receives the whole row, so a
   * formatter can read the underlying integer instead of the rounded value plotted.
   */
  formats?: Record<string, (row: Record<string, unknown>) => string>;
};

/**
 * The tooltip.
 *
 * Recharts' default is a white box with a grey border, hard-coded, so it stayed white on an ink
 * background. This one is the same popover surface as every menu and dialog in the product, and
 * it lays the series out as a label/value pair so the numbers align down the right edge instead
 * of trailing after the names at ragged offsets.
 */
export function ChartTooltip({ active, label, payload, formats = {} }: ChartTooltipProps) {
  if (active !== true || !payload || payload.length === 0) return null;

  return (
    <div className="min-w-40 rounded-md border border-border bg-popover px-3 py-2 shadow-overlay">
      <p className="mb-1.5 text-xs font-medium text-foreground">{label}</p>
      <ul className="flex flex-col gap-1">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? '');
          const format = formats[key];
          const row = item.payload ?? {};

          return (
            <li key={key} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-xs"
                  style={{ backgroundColor: item.color }}
                />
                {item.name}
              </span>
              <span className="shrink-0 font-medium tabular-nums text-foreground">
                {format ? format(row) : Number(item.value ?? 0).toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type ChartFrameProps = {
  title: string;
  description?: string;
  series: readonly ChartSeries[];
  /**
   * Set when the period holds nothing to plot. Replaces the plot area, and hides the legend —
   * a key to an absent chart is just noise.
   */
  emptyMessage?: string;
  /** The chart itself. A single element, because that is all `ResponsiveContainer` accepts. */
  children: React.ReactElement;
  className?: string;
};

/**
 * Card, title, legend and plot area for one chart.
 *
 * The legend sits beside the title rather than under the plot. Recharts' own legend is rendered
 * inside the SVG, which meant it competed with the x-axis labels for the same strip of space
 * and pushed the plot upwards; as a key to the colours it belongs with the heading it explains.
 */
export function ChartFrame({
  title,
  description,
  series,
  emptyMessage,
  children,
  className,
}: ChartFrameProps) {
  const isEmpty = emptyMessage !== undefined;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
        </div>
        {isEmpty ? null : (
          <ul className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            {series.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-xs"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </CardHeader>
      <CardContent className="flex-1">
        {isEmpty ? (
          <EmptyState size="compact" variant="plain" title="Nothing in this period" description={emptyMessage} />
        ) : (
          // A fixed height on every chart, so two charts side by side line up and neither
          // one reflows the page as its data loads.
          <div className="h-56 w-full sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
