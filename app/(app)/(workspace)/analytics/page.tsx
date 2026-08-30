import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Bot, Gauge, TrendingUp } from 'lucide-react';

import { AITelemetryView } from '@/components/analytics/ai-telemetry-view';
import { AnalyticsHeader } from '@/components/analytics/analytics-header';
import { AnalyticsKpiGrid } from '@/components/analytics/analytics-kpi-grid';
import { AIUsageChart } from '@/components/analytics/charts/ai-usage-chart';
import { MessagingVolumeChart } from '@/components/analytics/charts/messaging-volume-chart';
import { RevenueOrdersChart } from '@/components/analytics/charts/revenue-orders-chart';
import { EmptyAnalyticsState } from '@/components/analytics/empty-analytics-state';
import { UsageMeteringCard } from '@/components/analytics/usage-metering-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { roleHasPermission } from '@/server/authz/permissions';
import {
  getAITelemetry,
  getAnalyticsOverview,
  getWorkspaceUsageAndLimits,
  type UsageLimitStatus,
} from '@/server/services/analytics/analytics.service';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata: Metadata = {
  title: 'Analytics & Usage — WhatsApp OS',
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
      formattedRange: 'Last 7 Days',
    };
  }

  if (range === '90d') {
    const from = new Date(now.getTime() - 90 * DAY_MS);
    return {
      from,
      to: now,
      rangeKey: '90d',
      formattedRange: 'Last 90 Days',
    };
  }

  if (range === 'this_month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      from,
      to: now,
      rangeKey: 'this_month',
      formattedRange: 'This Month',
    };
  }

  if (range === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return {
      from,
      to,
      rangeKey: 'last_month',
      formattedRange: 'Last Month',
    };
  }

  // Default: 30 days
  const from = new Date(now.getTime() - 30 * DAY_MS);
  return {
    from,
    to: now,
    rangeKey: '30d',
    formattedRange: 'Last 30 Days',
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

  const [overview, telemetry, usageStatus] = await Promise.all([
    getAnalyticsOverview(context, { from, to }),
    getAITelemetry(context, { from, to }),
    canReadUsage ? getWorkspaceUsageAndLimits(context) : (null as UsageLimitStatus | null),
  ]);

  const isEmpty =
    overview.summary.totalMessages === 0 &&
    overview.summary.ordersCount === 0 &&
    overview.summary.aiRequests === 0 &&
    overview.summary.contactsTotal === 0;

  return (
    <div className="flex flex-col gap-8 pb-12">
      <AnalyticsHeader currentRange={rangeKey} formattedRange={formattedRange} />

      {isEmpty ? (
        <EmptyAnalyticsState />
      ) : (
        <Tabs defaultValue="overview" className="flex flex-col gap-6">
          <TabsList className="grid w-full grid-cols-2 md:w-auto md:inline-flex md:grid-cols-none">
            <TabsTrigger value="overview" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              Overview & Operations
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Bot className="h-4 w-4" />
              AI Telemetry & Costs
            </TabsTrigger>
            {usageStatus ? (
              <TabsTrigger value="usage" className="gap-2">
                <Gauge className="h-4 w-4" />
                Plan Quotas & Usage
              </TabsTrigger>
            ) : null}
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="flex flex-col gap-6 mt-0">
            <AnalyticsKpiGrid summary={overview.summary} currency={context.currency} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RevenueOrdersChart data={overview.timeSeries} currency={context.currency} />
              <MessagingVolumeChart data={overview.timeSeries} />
            </div>
          </TabsContent>

          {/* AI Telemetry Tab */}
          <TabsContent value="ai" className="flex flex-col gap-6 mt-0">
            <div className="grid grid-cols-1 gap-6">
              <AIUsageChart data={overview.timeSeries} />
              <AITelemetryView telemetry={telemetry} />
            </div>
          </TabsContent>

          {/* Usage Metering Tab */}
          {usageStatus ? (
            <TabsContent value="usage" className="flex flex-col gap-6 mt-0">
              <UsageMeteringCard status={usageStatus} />
            </TabsContent>
          ) : null}
        </Tabs>
      )}
    </div>
  );
}
