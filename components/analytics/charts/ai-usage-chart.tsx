'use client';

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

import {
  AXIS_PROPS,
  CHART_MARGIN,
  ChartFrame,
  ChartTooltip,
  GRID_PROPS,
  chartColor,
  formatChartDate,
} from '@/components/analytics/charts/chart-kit';
import { formatUsdMicros } from '@/lib/money';
import type { TimeSeriesDataPoint } from '@/server/repositories/analytics.repository';

const REPLIES_COLOR = chartColor(5);
const COST_COLOR = chartColor(2);

interface AIUsageChartProps {
  data: TimeSeriesDataPoint[];
}

/**
 * What the AI did each day, and what it cost.
 *
 * Cost is recorded in micros — millionths of a dollar — because a single cheap model turn can
 * cost a few hundred of them. The plotted value is converted to dollars for the axis, but the
 * tooltip formats the stored micros directly, so a real charge of a fraction of a cent is
 * reported as such instead of rounding to "$0.00" and making the AI look free.
 */
export function AIUsageChart({ data }: AIUsageChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    label: formatChartDate(point.date),
    costUsd: point.aiCostMicros / 1_000_000,
  }));

  const hasData = chartData.some((point) => point.aiRequests > 0 || point.aiCostMicros > 0);

  return (
    <ChartFrame
      title="AI replies and cost"
      description="How many messages your AI answered each day, and what those answers cost."
      series={[
        { label: 'Replies', color: REPLIES_COLOR },
        { label: 'Cost', color: COST_COLOR },
      ]}
      emptyMessage={
        hasData ? undefined : 'Your AI did not answer any messages in this period.'
      }
    >
      <LineChart data={chartData} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis yAxisId="replies" {...AXIS_PROPS} width={44} allowDecimals={false} />
        <YAxis
          yAxisId="cost"
          orientation="right"
          {...AXIS_PROPS}
          width={56}
          tickFormatter={formatCostTick}
        />
        <Tooltip
          cursor={{ stroke: 'hsl(var(--border-strong))', strokeWidth: 1 }}
          content={
            <ChartTooltip
              formats={{
                aiRequests: (row) => Number(row.aiRequests ?? 0).toLocaleString(),
                costUsd: (row) => formatUsdMicros(Number(row.aiCostMicros ?? 0), { precise: true }),
              }}
            />
          }
        />

        <Line
          yAxisId="replies"
          type="monotone"
          dataKey="aiRequests"
          name="Replies"
          stroke={REPLIES_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Line
          yAxisId="cost"
          type="monotone"
          dataKey="costUsd"
          name="Cost"
          stroke={COST_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </LineChart>
    </ChartFrame>
  );
}

/**
 * A cost axis tick.
 *
 * The precision follows the magnitude of the tick rather than being fixed: a workspace spending
 * cents a day and one spending hundreds of dollars a day share this axis, and two decimal places
 * would render every tick of the first as "$0.00".
 */
function formatCostTick(value: number): string {
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(2)}`;

  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
