'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney, money } from '@/lib/money';
import type { SupportedCurrency } from '@/config/constants';
import type { TimeSeriesDataPoint } from '@/server/repositories/analytics.repository';

interface RevenueOrdersChartProps {
  data: TimeSeriesDataPoint[];
  currency: SupportedCurrency;
}

function formatDateLabel(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-');
    if (!month || !day) return dateStr;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function RevenueOrdersChart({ data, currency }: RevenueOrdersChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    formattedDate: formatDateLabel(d.date),
    revenueMajor: d.revenueMinor / 100,
  }));

  const hasData = chartData.some((d) => d.revenueMinor > 0 || d.ordersCount > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Revenue & Order Trends</CardTitle>
        <CardDescription>Daily completed sales revenue and total paid orders.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No revenue or order transactions recorded for this period.
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="ordersGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" className="dark:stroke-neutral-800" />
                <XAxis
                  dataKey="formattedDate"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                  stroke="#888888"
                />
                <YAxis
                  yAxisId="left"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                  stroke="#888888"
                  tickFormatter={(val) => `${val.toLocaleString()}`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                  stroke="#888888"
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(value: unknown, name: string | undefined) => {
                    if (name === 'Revenue') {
                      const minor = Math.round(Number(value) * 100);
                      return [formatMoney(money(minor, currency)), 'Revenue'];
                    }
                    if (name === 'Orders') {
                      return [Number(value), 'Orders'];
                    }
                    return [String(value), name ?? ''];
                  }}
                  labelFormatter={(label) => `Date: ${label}`}
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="revenueMajor"
                  name="Revenue"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#revenueGrad)"
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="ordersCount"
                  name="Orders"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#ordersGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
