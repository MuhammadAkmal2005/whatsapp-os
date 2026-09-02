'use client';

import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';

import {
  AXIS_PROPS,
  CHART_MARGIN,
  ChartFrame,
  ChartTooltip,
  GRID_PROPS,
  chartColor,
  formatChartDate,
} from '@/components/analytics/charts/chart-kit';
import type { TimeSeriesDataPoint } from '@/server/repositories/analytics.repository';

const INBOUND_COLOR = chartColor(4);
const OUTBOUND_COLOR = chartColor(1);
const NEW_CHATS_COLOR = chartColor(3);

interface MessagingVolumeChartProps {
  data: TimeSeriesDataPoint[];
}

/**
 * Message traffic by day, split by direction, with new conversations alongside.
 *
 * The three series used to be three side-by-side bars. Over ninety days that is two hundred and
 * seventy bars a few pixels wide, and nothing in it could be read. Messages in and out now stack
 * into one bar per day — the height is the day's total traffic and the split shows who was doing
 * the talking — while new conversations, which count threads rather than messages, are drawn as a
 * line on their own axis so the two units are never added together by eye.
 */
export function MessagingVolumeChart({ data }: MessagingVolumeChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    label: formatChartDate(point.date),
  }));

  const hasData = chartData.some(
    (point) => point.messagesIn > 0 || point.messagesOut > 0 || point.conversationsNew > 0,
  );

  return (
    <ChartFrame
      title="Messages"
      description="Daily traffic, split between what customers sent you and what went back out."
      series={[
        { label: 'From customers', color: INBOUND_COLOR },
        { label: 'Your replies', color: OUTBOUND_COLOR },
        { label: 'New conversations', color: NEW_CHATS_COLOR },
      ]}
      emptyMessage={
        hasData ? undefined : 'No messages were sent or received in this period.'
      }
    >
      <ComposedChart data={chartData} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis yAxisId="messages" {...AXIS_PROPS} width={44} allowDecimals={false} />
        <YAxis
          yAxisId="conversations"
          orientation="right"
          {...AXIS_PROPS}
          width={36}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: 'hsl(var(--surface-selected))' }}
          content={
            <ChartTooltip
              formats={{
                messagesIn: (row) => Number(row.messagesIn ?? 0).toLocaleString(),
                messagesOut: (row) => Number(row.messagesOut ?? 0).toLocaleString(),
                conversationsNew: (row) => Number(row.conversationsNew ?? 0).toLocaleString(),
              }}
            />
          }
        />

        {/* Declared bottom-up: the last bar in a stack is the top one, so it carries the
            rounded cap and the one beneath it stays square. */}
        <Bar
          yAxisId="messages"
          dataKey="messagesIn"
          name="From customers"
          stackId="messages"
          fill={INBOUND_COLOR}
          maxBarSize={28}
        />
        <Bar
          yAxisId="messages"
          dataKey="messagesOut"
          name="Your replies"
          stackId="messages"
          fill={OUTBOUND_COLOR}
          radius={[3, 3, 0, 0]}
          maxBarSize={28}
        />
        <Line
          yAxisId="conversations"
          type="monotone"
          dataKey="conversationsNew"
          name="New conversations"
          stroke={NEW_CHATS_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ChartFrame>
  );
}
