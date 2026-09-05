import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatMoney, money } from '@/lib/money';
import type { SupportedCurrency } from '@/config/constants';
import type { RevenueIntelligenceSummary } from '@/server/repositories/revenue-intelligence.repository';
import { Bot, CheckCircle2, ShieldAlert, ShieldCheck, XCircle, Clock } from 'lucide-react';

interface AIOutcomesCardProps {
  summary: RevenueIntelligenceSummary;
  currency: SupportedCurrency;
}

export function AIOutcomesCard({ summary, currency }: AIOutcomesCardProps) {
  const approvalTypes = Object.entries(summary.approvalsByType);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle>AI Automation & Approvals</CardTitle>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {summary.groundingPassRate}% Grounded
          </Badge>
        </div>
        <CardDescription>
          Audited business actions performed by AI and decisions requiring human staff authorization.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Top metrics row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">AI-Created Orders</div>
            <div className="text-xl font-bold font-mono mt-1 text-foreground">
              {summary.aiCreatedOrdersCount.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {formatMoney(money(summary.aiCreatedRevenueMinor, currency))}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">Approvals Requested</div>
            <div className="text-xl font-bold font-mono mt-1 text-foreground">
              {summary.approvalsRequestedCount.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {summary.approvalsPendingCount} awaiting review
            </div>
          </div>

          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">Executed by Staff</div>
            <div className="text-xl font-bold font-mono mt-1 text-emerald-600 dark:text-emerald-400">
              {summary.approvalsExecutedCount.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {summary.approvalsApprovedCount} approved
            </div>
          </div>

          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">Hallucinations Prevented</div>
            <div className="text-xl font-bold font-mono mt-1 text-amber-600 dark:text-amber-400">
              {summary.groundingBlockedCount.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Grounding gate blocked
            </div>
          </div>
        </div>

        {/* Approval breakdown */}
        <div className="flex flex-col gap-2 rounded-lg border p-4 bg-muted/30">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Action Approval Worklist Status
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              <span>Pending: <strong>{summary.approvalsPendingCount}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" aria-hidden />
              <span>Approved: <strong>{summary.approvalsApprovedCount}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
              <span>Executed: <strong>{summary.approvalsExecutedCount}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
              <span>Rejected: <strong>{summary.approvalsRejectedCount}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5 text-orange-500" aria-hidden />
              <span>Stale / Failed: <strong>{summary.approvalsFailedCount}</strong></span>
            </div>
          </div>

          {approvalTypes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
              <span className="text-xs text-muted-foreground mr-1 self-center">Requested Actions:</span>
              {approvalTypes.map(([type, count]) => (
                <Badge key={type} variant="secondary" className="text-xs">
                  {formatActionType(type)}: {count}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function formatActionType(type: string): string {
  switch (type) {
    case 'ORDER_CANCEL':
      return 'Cancellation';
    case 'ORDER_MODIFY':
      return 'Order Modification';
    case 'REFUND_REQUEST':
      return 'Refund Request';
    case 'ADDRESS_CHANGE':
      return 'Address Change';
    case 'EXCEPTIONAL_DISCOUNT':
      return 'Custom Discount';
    default:
      return type;
  }
}
