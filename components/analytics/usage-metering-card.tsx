import { PlanLimitList, type PlanLimitRow } from '@/components/billing/plan-limit-list';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardTitle, CardToolbar } from '@/components/ui/card';
import type { LimitName } from '@/config/plans';
import type { UsageLimitStatus } from '@/server/services/analytics/analytics.service';

interface UsageMeteringCardProps {
  status: UsageLimitStatus;
}

/**
 * What the workspace is allowed on its plan, and how much of it is gone.
 *
 * The rows themselves are `PlanLimitList`, shared with the billing screen, which shows the same
 * ten allowances — they were two separate inventions of the same panel, disagreeing on both the
 * wording and the colour of a nearly-full bar.
 */
export function UsageMeteringCard({ status }: UsageMeteringCardProps) {
  const rows: PlanLimitRow[] = (Object.keys(status.limits) as LimitName[]).map((name) => {
    const check = status.limits[name];

    return {
      name,
      used: check.used,
      limit: check.limit,
      nearLimit: check.nearLimit,
      exceeded: !check.allowed,
    };
  });

  return (
    <Card>
      <CardToolbar>
        <div className="min-w-0">
          <CardTitle>Plan limits</CardTitle>
          <CardDescription className="mt-1">
            What your plan allows, and how much of it you have used. Monthly allowances start
            again at the beginning of each month.
          </CardDescription>
        </div>
        <Badge variant="outline" size="lg" className="uppercase tracking-wide">
          {status.planName}
        </Badge>
      </CardToolbar>

      <PlanLimitList rows={rows} monthlyHeading={`This month · ${formatPeriod(status.periodKey)}`} />
    </Card>
  );
}

/**
 * The billing period as a month a person would say out loud, rather than the `2026-09` key the
 * usage records are filed under.
 */
function formatPeriod(periodKey: string): string {
  const [year, month] = periodKey.split('-');
  const monthIndex = Number(month) - 1;

  if (!year || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return periodKey;
  }

  return new Date(Number(year), monthIndex, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}
