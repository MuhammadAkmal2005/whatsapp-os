'use client';

import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';

import {
  AXIS_PROPS,
  CHART_MARGIN,
  ChartFrame,
  ChartTooltip,
  GRID_PROPS,
  chartColor,
  formatChartDate,
} from '@/components/analytics/charts/chart-kit';
import type { SupportedCurrency } from '@/config/constants';
import { currencySymbol, formatMoney, money } from '@/lib/money';
import type { TimeSeriesDataPoint } from '@/server/repositories/analytics.repository';

const REVENUE_COLOR = chartColor(1);
const ORDERS_COLOR = chartColor(2);

interface RevenueOrdersChartProps {
  data: TimeSeriesDataPoint[];
  currency: SupportedCurrency;
}

/**
 * Money taken and orders placed, by day.
 *
 * Two quantities on two scales, so they are drawn in two different forms: revenue as a filled
 * area against the left axis, orders as a plain line against the right. The previous version
 * drew both as filled areas, which invites reading one as larger than the other when they are
 * not on the same scale at all — a day with two orders and a day with Rs. 40,000 sat at the
 * same height.
 */
export function RevenueOrdersChart({ data, currency }: RevenueOrdersChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    label: formatChartDate(point.date),
    // Recharts plots numbers, and minor units would put the axis in paisa.
    revenueMajor: point.revenueMinor / 100,
  }));

  const hasData = chartData.some((point) => point.revenueMinor > 0 || point.ordersCount > 0);
  const symbol = currencySymbol(currency);

  return (
    <ChartFrame
      title="Sales"
      description="What you earned each day, and how many orders it came from."
      series={[
        { label: 'Revenue', color: REVENUE_COLOR },
        { label: 'Orders', color: ORDERS_COLOR },
      ]}
      emptyMessage={
        hasData ? undefined : 'No orders were paid for in this period, so there is nothing to plot.'
      }
    >
      <ComposedChart data={chartData} margin={CHART_MARGIN}>
        <defs>
          {/* A soft fill under the revenue line rather than a solid block, so the grid rules
              stay readable through it. */}
          <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={REVENUE_COLOR} stopOpacity={0.22} />
            <stop offset="100%" stopColor={REVENUE_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis
          yAxisId="revenue"
          {...AXIS_PROPS}
          width={64}
          tickFormatter={(value: number) => formatAxisAmount(value, symbol)}
        />
        <YAxis
          yAxisId="orders"
          orientation="right"
          {...AXIS_PROPS}
          width={36}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: 'hsl(var(--border-strong))', strokeWidth: 1 }}
          content={
            <ChartTooltip
              formats={{
                revenueMajor: (row) =>
                  formatMoney(money(Math.round(Number(row.revenueMinor ?? 0)), currency)),
                ordersCount: (row) => Number(row.ordersCount ?? 0).toLocaleString(),
              }}
            />
          }
        />

        <Area
          yAxisId="revenue"
          type="monotone"
          dataKey="revenueMajor"
          name="Revenue"
          stroke={REVENUE_COLOR}
          strokeWidth={2}
          fill="url(#revenue-fill)"
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Line
          yAxisId="orders"
          type="monotone"
          dataKey="ordersCount"
          name="Orders"
          stroke={ORDERS_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ChartFrame>
  );
}

/**
 * A money axis tick. Abbreviated because an axis has room for four or five characters, and
 * "Rs. 1,240,000" on every tick would take more width than the plot.
 */
function formatAxisAmount(value: number, symbol: string): string {
  const digits = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

  return `${symbol}${digits}`;
}
