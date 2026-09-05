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
import type { RevenueDailyPoint } from '@/server/repositories/revenue-intelligence.repository';

const BOOKED_COLOR = chartColor(1);
const PAID_COLOR = chartColor(2);
const CHAT_COLOR = chartColor(3);

interface RevenueFunnelChartProps {
  data: RevenueDailyPoint[];
  currency: SupportedCurrency;
}

export function RevenueFunnelChart({ data, currency }: RevenueFunnelChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    label: formatChartDate(point.date),
    bookedMajor: point.bookedRevenueMinor / 100,
    paidMajor: point.paidRevenueMinor / 100,
    chatMajor: point.chatRevenueMinor / 100,
  }));

  const hasData = chartData.some(
    (point) => point.bookedRevenueMinor > 0 || point.paidRevenueMinor > 0 || point.chatRevenueMinor > 0,
  );
  const symbol = currencySymbol(currency);

  return (
    <ChartFrame
      title="Revenue Breakdown by Channel & Realization"
      description="Comparing total booked orders, realized paid revenue, and orders originating directly in customer chat."
      series={[
        { label: 'Booked Revenue', color: BOOKED_COLOR },
        { label: 'Paid Revenue', color: PAID_COLOR },
        { label: 'Chat Revenue', color: CHAT_COLOR },
      ]}
      emptyMessage={
        hasData
          ? undefined
          : 'No qualifying revenue was recorded in this period to plot.'
      }
    >
      <ComposedChart data={chartData} margin={CHART_MARGIN}>
        <defs>
          <linearGradient id="booked-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BOOKED_COLOR} stopOpacity={0.18} />
            <stop offset="100%" stopColor={BOOKED_COLOR} stopOpacity={0} />
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
        <Tooltip
          cursor={{ stroke: 'hsl(var(--border-strong))', strokeWidth: 1 }}
          content={
            <ChartTooltip
              formats={{
                bookedMajor: (row) =>
                  formatMoney(money(Math.round(Number(row.bookedRevenueMinor ?? 0)), currency)),
                paidMajor: (row) =>
                  formatMoney(money(Math.round(Number(row.paidRevenueMinor ?? 0)), currency)),
                chatMajor: (row) =>
                  formatMoney(money(Math.round(Number(row.chatRevenueMinor ?? 0)), currency)),
              }}
            />
          }
        />

        <Area
          yAxisId="revenue"
          type="monotone"
          dataKey="bookedMajor"
          name="Booked Revenue"
          stroke={BOOKED_COLOR}
          strokeWidth={2}
          fill="url(#booked-fill)"
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Line
          yAxisId="revenue"
          type="monotone"
          dataKey="paidMajor"
          name="Paid Revenue"
          stroke={PAID_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Line
          yAxisId="revenue"
          type="monotone"
          dataKey="chatMajor"
          name="Chat Revenue"
          stroke={CHAT_COLOR}
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ChartFrame>
  );
}

function formatAxisAmount(value: number, symbol: string): string {
  const digits = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

  return `${symbol}${digits}`;
}
