import { AlertTriangle, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UsageLimitStatus } from '@/server/services/analytics/analytics.service';
import type { LimitName } from '@/config/plans';

interface UsageMeteringCardProps {
  status: UsageLimitStatus;
}

const LIMIT_TITLES: Record<LimitName, string> = {
  whatsappNumbers: 'WhatsApp Phone Numbers',
  teamMembers: 'Active Team Members',
  contacts: 'Customer Contacts',
  products: 'Catalogue Products',
  aiRequestsPerMonth: 'Monthly AI Requests',
  messagesPerMonth: 'Monthly WhatsApp Messages',
  knowledgeDocuments: 'Knowledge Documents',
  storageMegabytes: 'File Storage (MB)',
  automations: 'Active Workflows',
  campaignsPerMonth: 'Monthly Broadcast Campaigns',
};

export function UsageMeteringCard({ status }: UsageMeteringCardProps) {
  const limitEntries = Object.entries(status.limits) as [
    LimitName,
    (typeof status.limits)[LimitName],
  ][];

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-medium">Subscription & Usage Metering</CardTitle>
            <Badge variant="outline" className="uppercase font-semibold tracking-wider">
              {status.planName} Plan
            </Badge>
          </div>
          <CardDescription>
            Billing cycle period: <span className="font-mono font-medium">{status.periodKey}</span>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {limitEntries.map(([limitKey, check]) => {
            const label = LIMIT_TITLES[limitKey] ?? limitKey;
            const isUnlimited = check.limit === null;
            const percentage = isUnlimited ? 0 : Math.min(100, Math.round(check.ratio * 100));

            return (
              <div key={limitKey} className="flex flex-col gap-1.5 rounded-lg border p-3.5 bg-card">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{label}</span>
                  {isUnlimited ? (
                    <Badge variant="secondary" className="text-xs">
                      Unlimited
                    </Badge>
                  ) : check.allowed ? (
                    check.nearLimit ? (
                      <Badge variant="outline" className="text-xs border-amber-500 text-amber-600 dark:text-amber-400 gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Near Quota
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {check.remaining} remaining
                      </Badge>
                    )
                  ) : (
                    <Badge variant="danger" className="text-xs gap-1">
                      <ShieldAlert className="h-3 w-3" />
                      Limit Exceeded
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Used: <strong className="text-foreground">{check.used.toLocaleString()}</strong>
                  </span>
                  <span>
                    Quota: {isUnlimited ? '∞' : (check.limit?.toLocaleString() ?? '—')}
                  </span>
                </div>

                {/* Progress bar */}
                {!isUnlimited ? (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted mt-1">
                    <div
                      className={`h-full transition-all duration-300 ${
                        !check.allowed
                          ? 'bg-rose-500'
                          : check.nearLimit
                            ? 'bg-amber-500'
                            : 'bg-primary'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                ) : (
                  <div className="h-2 w-full rounded-full bg-muted/50 mt-1" />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
