import {
  Bot,
  Clock,
  MessageSquare,
  Percent,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

import { StatCard } from '@/components/dashboard/stat-card';
import { formatMoney, money } from '@/lib/money';
import type { SupportedCurrency } from '@/config/constants';
import type { WorkspaceAnalyticsSummary } from '@/server/repositories/analytics.repository';

interface AnalyticsKpiGridProps {
  summary: WorkspaceAnalyticsSummary;
  currency: SupportedCurrency;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = (minutes / 60).toFixed(1);
  return `${hours}h`;
}

export function AnalyticsKpiGrid({ summary, currency }: AnalyticsKpiGridProps) {
  const revenueFormatted = formatMoney(money(summary.revenueMinor, currency));
  const avgOrderFormatted = formatMoney(money(summary.avgOrderValueMinor, currency));
  const aiRevenueFormatted = formatMoney(money(summary.aiRevenueMinor, currency));

  const resolvedRate =
    summary.conversationsNew > 0
      ? Math.min(100, Math.round((summary.conversationsResolved / summary.conversationsNew) * 100))
      : 0;

  const aiHandledRate =
    summary.conversationsNew > 0
      ? Math.min(100, Math.round((summary.aiHandledConversations / summary.conversationsNew) * 100))
      : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total Revenue"
        value={revenueFormatted}
        icon={Wallet}
        hint={`${summary.paidOrdersCount} paid orders (${summary.ordersCount} total)`}
        tone="default"
      />

      <StatCard
        label="Average Order Value"
        value={avgOrderFormatted}
        icon={TrendingUp}
        hint={`AI-assisted revenue: ${aiRevenueFormatted}`}
        tone="default"
      />

      <StatCard
        label="Total Messages"
        value={summary.totalMessages.toLocaleString()}
        icon={MessageSquare}
        hint={`${summary.messagesIn.toLocaleString()} in / ${summary.messagesOut.toLocaleString()} out`}
        tone="default"
      />

      <StatCard
        label="Conversations"
        value={summary.conversationsNew.toLocaleString()}
        icon={Users}
        hint={`${summary.conversationsResolved} resolved (${resolvedRate}% rate)`}
        tone="default"
      />

      <StatCard
        label="Avg First Response"
        value={formatDuration(summary.avgFirstResponseMs)}
        icon={Clock}
        hint={`Avg resolution: ${formatDuration(summary.avgResolutionMs)}`}
        tone="default"
      />

      <StatCard
        label="AI Handled Rate"
        value={`${aiHandledRate}%`}
        icon={Bot}
        hint={`${summary.aiHandledConversations} AI chats, ${summary.handoffCount} handoffs`}
        tone={summary.handoffCount > 5 ? 'warning' : 'default'}
      />

      <StatCard
        label="AI Token Consumption"
        value={summary.aiTotalTokens.toLocaleString()}
        icon={Percent}
        hint={`${summary.aiRequests.toLocaleString()} turns (${(summary.aiCostMicros / 1000000).toFixed(4)} USD)`}
        tone="default"
      />

      <StatCard
        label="New Contacts & Leads"
        value={summary.contactsNew.toLocaleString()}
        icon={Users}
        hint={`${summary.leadsNew} leads identified`}
        tone="default"
      />
    </div>
  );
}
