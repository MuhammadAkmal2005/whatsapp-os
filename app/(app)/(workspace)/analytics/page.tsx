import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Bot, DollarSign, Gauge, TrendingUp } from 'lucide-react';

import { AITelemetryView } from '@/components/analytics/ai-telemetry-view';
import { AnalyticsHeader } from '@/components/analytics/analytics-header';
import { AnalyticsKpiGrid } from '@/components/analytics/analytics-kpi-grid';
import { AIUsageChart } from '@/components/analytics/charts/ai-usage-chart';
import { MessagingVolumeChart } from '@/components/analytics/charts/messaging-volume-chart';
import { RevenueOrdersChart } from '@/components/analytics/charts/revenue-orders-chart';
import { EmptyAnalyticsState } from '@/components/analytics/empty-analytics-state';
import { RevenueIntelligenceView } from '@/components/analytics/revenue-intelligence-view';
import { UsageMeteringCard } from '@/components/analytics/usage-metering-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { roleHasPermission } from '@/server/authz/permissions';
import {
  getAITelemetry,
  getAnalyticsOverview,
  getWorkspaceUsageAndLimits,
  type UsageLimitStatus,
} from '@/server/services/analytics/analytics.service';
import { getRevenueIntelligence } from '@/server/services/analytics/revenue-intelligence.service';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata: Metadata = {
  title: 'Analytics',
};

const DAY_MS = 24 * 60 * 60 * 1000;

interface PageProps {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    tab?: string;
  }>;
}

function resolveDateRange(params: { range?: string; from?: string; to?: string }): {
  from: Date;
  to: Date;
  rangeKey: string;
  formattedRange: string;
} {
  const now = new Date();
  const range = params.range ?? '30d';

  if (params.from && params.to) {
    const from = new Date(params.from);
    const to = new Date(params.to);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
      return {
        from,
        to,
        rangeKey: 'custom',
        formattedRange: `${from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
      };
    }
  }

  if (range === '7d') {
    const from = new Date(now.getTime() - 7 * DAY_MS);
    return {
      from,
      to: now,
      rangeKey: '7d',
      formattedRange: 'Last 7 days',
    };
  }

  if (range === '90d') {
    const from = new Date(now.getTime() - 90 * DAY_MS);
    return {
      from,
      to: now,
      rangeKey: '90d',
      formattedRange: 'Last 90 days',
    };
  }

  if (range === 'this_month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      from,
      to: now,
      rangeKey: 'this_month',
      formattedRange: 'This month',
    };
  }

  if (range === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return {
      from,
      to,
      rangeKey: 'last_month',
      formattedRange: 'Last month',
    };
  }

  // Default: 30 days
  const from = new Date(now.getTime() - 30 * DAY_MS);
  return {
    from,
    to: now,
    rangeKey: '30d',
    formattedRange: 'Last 30 days',
  };
}

export default async function AnalyticsPage(props: PageProps) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  if (!roleHasPermission(context.role, 'analytics:read')) {
    redirect('/dashboard');
  }

  const searchParams = await props.searchParams;
  const { from, to, rangeKey, formattedRange } = resolveDateRange(searchParams);

  const canReadUsage = roleHasPermission(context.role, 'usage:read');

  const [overview, telemetry, revenueReport, usageStatus] = await Promise.all([
    getAnalyticsOverview(context, { from, to }),
    getAITelemetry(context, { from, to }),
    getRevenueIntelligence(context, { from, to, range: rangeKey }),
    canReadUsage ? getWorkspaceUsageAndLimits(context) : (null as UsageLimitStatus | null),
  ]);

  const isEmpty =
    overview.summary.totalMessages === 0 &&
    overview.summary.ordersCount === 0 &&
    overview.summary.aiRequests === 0 &&
    overview.summary.contactsTotal === 0 &&
    revenueReport.summary.totalOrdersCount === 0;

  const activeTab = searchParams.tab || 'overview';

  return (
    <div className="flex flex-col gap-6">
      <AnalyticsHeader
        currentRange={rangeKey}
        formattedRange={formattedRange}
        from={from.toISOString()}
        to={to.toISOString()}
      />

      {isEmpty ? (
        <EmptyAnalyticsState />
      ) : (
        <Tabs defaultValue={activeTab} className="flex flex-col">
          {/* The list scrolls horizontally on a narrow screen rather than wrapping — three
              labels in a two-column grid put one on a second row inside a fixed-height
              track, which clipped it. */}
          <TabsList>
            <TabsTrigger value="overview">
              <TrendingUp aria-hidden />
              Overview
            </TabsTrigger>
            <TabsTrigger value="revenue">
              <DollarSign aria-hidden />
              Revenue intelligence
            </TabsTrigger>
            <TabsTrigger value="ai">
              <Bot aria-hidden />
              AI activity
            </TabsTrigger>
            {usageStatus ? (
              <TabsTrigger value="usage">
                <Gauge aria-hidden />
                Plan limits
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-6">
            <AnalyticsKpiGrid summary={overview.summary} currency={context.currency} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <RevenueOrdersChart data={overview.timeSeries} currency={context.currency} />
              <MessagingVolumeChart data={overview.timeSeries} />
            </div>
          </TabsContent>

          <TabsContent value="revenue" className="flex flex-col gap-6">
            <RevenueIntelligenceView report={revenueReport} currency={context.currency} />
          </TabsContent>

          <TabsContent value="ai" className="flex flex-col gap-6">
            <AIUsageChart data={overview.timeSeries} />
            <AITelemetryView telemetry={telemetry} />
          </TabsContent>

          {usageStatus ? (
            <TabsContent value="usage">
              <UsageMeteringCard status={usageStatus} />
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </div>
  );
}
