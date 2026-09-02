import { PlanLimitList, type PlanLimitRow } from '@/components/billing/plan-limit-list';
import { Card, CardDescription, CardTitle, CardToolbar } from '@/components/ui/card';
import type { QuotaMetricUsage } from '@/server/services/billing/limit-guard.service';

interface UsageOverviewCardProps {
  quotaUsage: QuotaMetricUsage[];
}

/**
 * How much of the plan the workspace is currently using, shown beside the plans it could move to.
 *
 * The rows are `PlanLimitList`, the same component the analytics screen uses — this panel and
 * that one were showing the same ten numbers in two different designs, with two different sets
 * of names for them.
 */
export function UsageOverviewCard({ quotaUsage }: UsageOverviewCardProps) {
  const rows: PlanLimitRow[] = quotaUsage.map((item) => ({
    name: item.metric,
    used: item.used,
    limit: item.limit,
    nearLimit: item.nearLimit,
    exceeded: item.limit !== null && item.used >= item.limit,
  }));

  return (
    <Card>
      <CardToolbar>
        <div className="min-w-0">
          <CardTitle>What you are using</CardTitle>
          <CardDescription className="mt-1">
            Current usage against your plan. If something here is close to full, that is the thing
            to check when comparing plans below.
          </CardDescription>
        </div>
      </CardToolbar>

      <PlanLimitList rows={rows} />
    </Card>
  );
}
