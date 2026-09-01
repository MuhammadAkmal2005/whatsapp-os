'use client';

import { Activity, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { QuotaMetricUsage } from '@/server/services/billing/limit-guard.service';

interface UsageOverviewCardProps {
  quotaUsage: QuotaMetricUsage[];
}

export function UsageOverviewCard({ quotaUsage }: UsageOverviewCardProps) {
  return (
    <Card className="border-border shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-primary" />
            <CardTitle className="text-lg font-semibold tracking-tight">
              Quota & Usage Metering
            </CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">
            Resets on monthly billing cycle
          </span>
        </div>
        <CardDescription className="text-xs text-muted-foreground">
          Real-time resource utilization against your active plan limits. Warnings appear automatically at 80% capacity.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {quotaUsage.map((item) => {
            const percent = Math.min(100, Math.round(item.ratio * 100));
            const isExceeded = item.limit !== null && item.used >= item.limit;
            const isNearLimit = item.nearLimit && !isExceeded;

            return (
              <div
                key={item.metric}
                className="p-3 rounded-lg border border-border/70 bg-card/50 flex flex-col justify-between gap-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {item.label}
                  </span>
                  {item.isUnmetered ? (
                    <Badge variant="outline" className="text-xs bg-emerald-50/50 text-emerald-700 border-emerald-200">
                      Unmetered
                    </Badge>
                  ) : isExceeded ? (
                    <Badge variant="danger" className="text-xs">
                      Limit reached
                    </Badge>
                  ) : isNearLimit ? (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-800 border-amber-300">
                      <AlertTriangle className="mr-1 size-2.5" />
                      80%+ used
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {item.remaining !== null ? `${item.remaining} remaining` : ''}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      <strong className="font-semibold text-foreground">
                        {item.used.toLocaleString()}
                      </strong>{' '}
                      / {item.limit !== null ? item.limit.toLocaleString() : '∞'}
                    </span>
                    {!item.isUnmetered && <span>{percent}%</span>}
                  </div>

                  {/* Progress Bar */}
                  {!item.isUnmetered ? (
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isExceeded
                            ? 'bg-rose-500'
                            : isNearLimit
                              ? 'bg-amber-500'
                              : 'bg-primary'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  ) : (
                    <div className="h-2 w-full bg-emerald-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 w-full" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
