import { Stat, StatBand } from '@/components/ui/stat';
import { formatMoney, formatUsdMicros, money } from '@/lib/money';
import type { SupportedCurrency } from '@/config/constants';
import type { WorkspaceAnalyticsSummary } from '@/server/repositories/analytics.repository';

interface AnalyticsKpiGridProps {
  summary: WorkspaceAnalyticsSummary;
  currency: SupportedCurrency;
}

/**
 * The eight headline figures for the selected date range.
 *
 * Presented as one band of peers rather than eight cards. Nothing here is emphasised over
 * anything else, and that is deliberate: unlike the dashboard, this screen exists to be
 * compared across, and the range's real headline is the revenue chart below. Nor is there a
 * tone on any cell — the previous version turned the handoff figure amber once it passed
 * five, a number chosen from nowhere, which told a busy shop with healthy escalation that
 * something was broken.
 *
 * Every value comes from the range-scoped analytics summary. Rates are computed here rather
 * than stored, and floor at zero when the denominator is zero instead of printing NaN.
 */
export function AnalyticsKpiGrid({ summary, currency }: AnalyticsKpiGridProps) {
  const asPercentOfNew = (part: number) =>
    summary.conversationsNew > 0
      ? Math.min(100, Math.round((part / summary.conversationsNew) * 100))
      : 0;

  return (
    <StatBand columns={4} label="Headline figures for the selected period">
      <Stat
        label="Revenue"
        value={formatMoney(money(summary.revenueMinor, currency))}
        hint={`${formatMoney(money(summary.aiRevenueMinor, currency))} of it from orders your AI created`}
      />
      <Stat
        label="Average order"
        value={formatMoney(money(summary.avgOrderValueMinor, currency))}
        hint={`Across ${summary.paidOrdersCount.toLocaleString()} paid of ${summary.ordersCount.toLocaleString()} orders`}
      />
      <Stat
        label="Messages"
        value={summary.totalMessages.toLocaleString()}
        hint={`${summary.messagesIn.toLocaleString()} received, ${summary.messagesOut.toLocaleString()} sent`}
      />
      <Stat
        label="New conversations"
        value={summary.conversationsNew.toLocaleString()}
        hint={`${summary.conversationsResolved.toLocaleString()} resolved (${asPercentOfNew(summary.conversationsResolved)}%)`}
      />
      <Stat
        label="First reply"
        value={formatDuration(summary.avgFirstResponseMs)}
        hint={`${formatDuration(summary.avgResolutionMs)} to resolve, on average`}
      />
      <Stat
        label="Handled by AI"
        value={`${asPercentOfNew(summary.aiHandledConversations)}%`}
        hint={`${summary.aiHandledConversations.toLocaleString()} conversations, ${summary.handoffCount.toLocaleString()} passed to a person`}
      />
      <Stat
        label="AI tokens"
        value={summary.aiTotalTokens.toLocaleString()}
        hint={`${summary.aiRequests.toLocaleString()} replies, about ${formatUsdMicros(summary.aiCostMicros)}`}
      />
      <Stat
        label="New customers"
        value={summary.contactsNew.toLocaleString()}
        hint={`${summary.leadsNew.toLocaleString()} of them still leads`}
      />
    </StatBand>
  );
}

/**
 * Durations at the granularity a person actually reasons about. Sub-minute figures matter
 * to the second; a four-hour resolution time does not, so it rounds. `null` means the range
 * held nothing to measure, which is different from zero and is shown as an em dash.
 */
function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}
