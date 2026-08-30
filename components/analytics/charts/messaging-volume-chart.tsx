'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TimeSeriesDataPoint } from '@/server/repositories/analytics.repository';

interface MessagingVolumeChartProps {
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

export function MessagingVolumeChart({ data }: MessagingVolumeChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    formattedDate: formatDateLabel(d.date),
  }));

  const hasData = chartData.some(
    (d) => d.messagesIn > 0 || d.messagesOut > 0 || d.conversationsNew > 0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Message & Conversation Activity</CardTitle>
        <CardDescription>Daily inbound vs outbound messages and new conversation threads.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No message activity recorded for this period.
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" className="dark:stroke-neutral-800" />
                <XAxis
                  dataKey="formattedDate"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                  stroke="#888888"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                  stroke="#888888"
                  allowDecimals={false}
                />
                <Tooltip
                  labelFormatter={(label) => `Date: ${label}`}
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Bar dataKey="messagesIn" name="Inbound Messages" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="messagesOut" name="Outbound Messages" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="conversationsNew" name="New Chats" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
