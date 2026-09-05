import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { RevenueIntelligenceSummary } from '@/server/repositories/revenue-intelligence.repository';
import { Headset, HelpCircle, ShieldAlert } from 'lucide-react';

interface InquiriesSignalsCardProps {
  summary: RevenueIntelligenceSummary;
}

export function InquiriesSignalsCard({ summary }: InquiriesSignalsCardProps) {
  const handoffEntries = Object.entries(summary.handoffReasons).sort((a, b) => b[1] - a[1]);
  const blockedEntries = Object.entries(summary.groundingBlockedReasons).sort((a, b) => b[1] - a[1]);

  const hasSignals = handoffEntries.length > 0 || blockedEntries.length > 0;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle>Customer Inquiries & Escalation Signals</CardTitle>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {summary.handoffsCount} Total Handoffs
          </Badge>
        </div>
        <CardDescription>
          Deterministic topics and triggers where customer conversations required human staff assistance.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!hasSignals ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No escalation or policy violation signals recorded in this period.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Handoff Reasons */}
            <div className="rounded-lg border p-4 bg-muted/20">
              <div className="flex items-center gap-2 mb-3">
                <Headset className="h-4 w-4 text-blue-500" aria-hidden />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Staff Escalation Triggers
                </span>
              </div>
              {handoffEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No human handoffs recorded.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {handoffEntries.map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between text-xs">
                      <span className="text-foreground font-medium">
                        {formatHandoffReason(reason)}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {count.toLocaleString()} ({Math.round((count / (summary.handoffsCount || 1)) * 100)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Grounding Block Reasons */}
            <div className="rounded-lg border p-4 bg-muted/20">
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert className="h-4 w-4 text-amber-500" aria-hidden />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Policy & Concession Inquiries Blocked
                </span>
              </div>
              {blockedEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No ungrounded claims blocked.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {blockedEntries.map(([reason, count]) => (
                    <div key={reason} className="flex items-center justify-between text-xs">
                      <span className="text-foreground font-medium">
                        {formatBlockedReason(reason)}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatHandoffReason(reason: string): string {
  switch (reason) {
    case 'CUSTOMER_REQUESTED':
      return 'Customer asked for human agent';
    case 'REFUND_REQUEST':
      return 'Refund / return inquiry';
    case 'COMPLAINT':
      return 'Customer complaint or dissatisfaction';
    case 'NEGATIVE_SENTIMENT':
      return 'Negative sentiment detected';
    case 'HIGH_VALUE_CUSTOMER':
      return 'High-value customer priority';
    case 'SENSITIVE_TOPIC':
      return 'Sensitive inquiry';
    case 'PAYMENT_ISSUE':
      return 'Payment or bank transfer query';
    case 'LOW_CONFIDENCE':
      return 'Complex or ungrounded question';
    case 'UNKNOWN_QUESTION':
      return 'Uncatalogued knowledge inquiry';
    case 'AI_ERROR':
      return 'AI processing exception';
    case 'OUTSIDE_BUSINESS_HOURS':
      return 'Outside business hours';
    default:
      return reason.replace(/_/g, ' ').toLowerCase();
  }
}

function formatBlockedReason(reason: string): string {
  switch (reason) {
    case 'UNSUPPORTED_DISCOUNT_CLAIM':
      return 'Unauthorized discount request';
    case 'UNSUPPORTED_POLICY_CLAIM':
      return 'Return / delivery policy conflict';
    case 'FALSE_ORDER_CONFIRMATION_CLAIM':
      return 'Unverified order confirmation blocked';
    case 'UNSUPPORTED_ORDER_MUTATION_CLAIM':
      return 'Autonomous order cancellation blocked';
    case 'UNSUPPORTED_PAYMENT_CLAIM':
      return 'Unsupported payment method requested';
    default:
      return reason.replace(/_/g, ' ').toLowerCase();
  }
}
