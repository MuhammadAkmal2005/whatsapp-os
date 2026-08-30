'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TimeSeriesDataPoint } from '@/server/repositories/analytics.repository';

interface AIUsageChartProps {
  data: TimeSeriesDataPoint[];
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

export function AIUsageChart({ data }: AIUsageChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    formattedDate: formatDateLabel(d.date),
    costUsd: Number((d.aiCostMicros / 1000000).toFixed(4)),
  }));

  const hasData = chartData.some((d) => d.aiRequests > 0 || d.aiCostMicros > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">AI Turns & Cost Telemetry</CardTitle>
        <CardDescription>Daily automated LLM turns executed and aggregated compute cost.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No AI agent turns recorded for this period.
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                  stroke="#888888"
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  formatter={(value: unknown, name: string | undefined) => {
                    if (name === 'Est. Cost') {
                      return [`$${Number(value).toFixed(4)} USD`, 'Est. Cost'];
                    }
                    if (name === 'AI Turns') {
                      return [Number(value), 'AI Turns'];
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
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="aiRequests"
                  name="AI Turns"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="costUsd"
                  name="Est. Cost"
                  stroke="#ec4899"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
