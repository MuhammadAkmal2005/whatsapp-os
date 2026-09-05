import { Stat, StatBand } from '@/components/ui/stat';
import { formatMoney, money } from '@/lib/money';
import type { SupportedCurrency } from '@/config/constants';
import type { RevenueIntelligenceReport } from '@/server/services/analytics/revenue-intelligence.service';
import { RevenueFunnelChart } from '@/components/analytics/charts/revenue-funnel-chart';
import { ProductDemandTable } from '@/components/analytics/product-demand-table';
import { AIOutcomesCard } from '@/components/analytics/ai-outcomes-card';
import { InquiriesSignalsCard } from '@/components/analytics/inquiries-signals-card';
import { Info } from 'lucide-react';

interface RevenueIntelligenceViewProps {
  report: RevenueIntelligenceReport;
  currency: SupportedCurrency;
}

export function RevenueIntelligenceView({ report, currency }: RevenueIntelligenceViewProps) {
  const { summary, trends, timeSeries } = report;

  return (
    <div className="flex flex-col gap-6">
      {/* Top StatBand with Period-over-Period Comparisons */}
      <StatBand columns={4} label="Revenue & Commerce Intelligence">
        <Stat
          label="Realized Revenue"
          value={formatMoney(money(summary.paidRevenueMinor, currency))}
          hint={formatTrendHint(trends.paidRevenue, report.period.rangeKey)}
        />

        <Stat
          label="Booked Orders"
          value={summary.bookedOrdersCount.toLocaleString()}
          hint={`${formatTrendHint(trends.bookedOrders, report.period.rangeKey)} • AOV ${formatMoney(money(summary.avgOrderValueMinor, currency))}`}
        />

        <Stat
          label="Orders from Chat"
          value={summary.directChatOrdersCount.toLocaleString()}
          hint={`${formatMoney(money(summary.directChatRevenueMinor, currency))} from conversations`}
        />

        <Stat
          label="Chat-to-Order Conversion"
          value={`${summary.chatConversionRate}%`}
          hint={`${summary.orderingChatCustomersCount} ordered of ${summary.activeChatCustomersCount} active contacts`}
        />
      </StatBand>

      {/* Secondary Quick Signals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Conversations Without Order</div>
          <div className="text-lg font-bold font-mono mt-1 text-foreground">
            {summary.unconvertedChatCustomersCount.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Chatted with no order placed
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Cancelled Orders</div>
          <div className="text-lg font-bold font-mono mt-1 text-muted-foreground">
            {summary.cancelledOrdersCount.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatMoney(money(summary.cancelledRevenueMinor, currency))} excluded from revenue
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">AI-Created Revenue</div>
          <div className="text-lg font-bold font-mono mt-1 text-foreground">
            {formatMoney(money(summary.aiCreatedRevenueMinor, currency))}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Across {summary.aiCreatedOrdersCount} automated orders
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">Active Customers</div>
          <div className="text-lg font-bold font-mono mt-1 text-foreground">
            {summary.activeChatCustomersCount.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Participated in {summary.totalConversations} conversations
          </div>
        </div>
      </div>

      {/* Revenue Funnel Chart */}
      <RevenueFunnelChart data={timeSeries} currency={currency} />

      {/* Product Demand Table & Operational Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProductDemandTable products={summary.topProducts} currency={currency} />
        <AIOutcomesCard summary={summary} currency={currency} />
      </div>

      {/* Inquiries & Objections Card */}
      <InquiriesSignalsCard summary={summary} />

      {/* Attribution & Privacy Governance Note */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground flex items-start gap-3">
        <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">Attribution & Data Integrity Note</span>
          <p>
            Revenue Intelligence computes figures strictly from authoritative database records (orders, payments, conversations, and AI telemetry).
            Orders originating from conversations reflect explicit conversation references or verified customer interactions, not speculative causal models. Cancelled and refunded orders are rigorously excluded from realized revenue.
          </p>
        </div>
      </div>
    </div>
  );
}

function formatTrendHint(trend: { delta: number; percentageChange: number | null }, label: string): string {
  if (trend.percentageChange === null) {
    return `— vs previous ${label}`;
  }
  const prefix = trend.percentageChange > 0 ? '+' : '';
  return `${prefix}${trend.percentageChange}% vs previous ${label}`;
}

