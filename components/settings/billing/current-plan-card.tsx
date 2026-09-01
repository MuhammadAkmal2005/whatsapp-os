'use client';

import { AlertCircle, AlertTriangle, Calendar, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { WorkspaceBillingSummaryDTO } from '@/server/services/subscription/subscription.service';

function formatMinorToPkr(minor: number): string {
  if (minor === 0) return 'Free';
  const major = Math.round(minor / 100);
  return `Rs. ${major.toLocaleString('en-PK')}`;
}

function formatDateDisplay(iso: string | null): string {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

interface CurrentPlanCardProps {
  billing: WorkspaceBillingSummaryDTO;
  onCancelSubscription: () => Promise<void>;
  onResumeSubscription: () => Promise<void>;
  isActionLoading: boolean;
}

export function CurrentPlanCard({
  billing,
  onCancelSubscription,
  onResumeSubscription,
  isActionLoading,
}: CurrentPlanCardProps) {
  const { subscription, plan, canManage } = billing;

  const isTrialActive = subscription.isTrial && !subscription.isTrialExpired;
  const isTrialExpired = subscription.isTrialExpired;
  const isCanceledPending = subscription.cancelAtPeriodEnd;
  const isFreePlan = subscription.planKey === 'free' || plan.key === 'free';

  return (
    <Card className="border-border shadow-card">
      <CardHeader className="flex flex-row items-start justify-between pb-4">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl font-bold tracking-tight">
              {plan.name} Plan
            </CardTitle>
            {isTrialActive && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200">
                <Clock className="mr-1 size-3" />
                {subscription.trialDaysRemaining ?? 0} days left in trial
              </Badge>
            )}
            {isTrialExpired && (
              <Badge variant="warning" className="bg-amber-100 text-amber-900 border-amber-300">
                <AlertTriangle className="mr-1 size-3" />
                Trial Expired
              </Badge>
            )}
            {!isTrialActive && !isTrialExpired && subscription.status === 'ACTIVE' && (
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                <CheckCircle2 className="mr-1 size-3" />
                Active
              </Badge>
            )}
            {isCanceledPending && (
              <Badge variant="danger" className="bg-rose-100 text-rose-900 border-rose-300">
                Cancels at period end
              </Badge>
            )}
          </div>
          <CardDescription className="mt-1 text-sm text-muted-foreground">
            {plan.tagline}
          </CardDescription>
        </div>

        <div className="text-right">
          <span className="text-2xl font-bold text-foreground">
            {formatMinorToPkr(plan.priceMinor)}
          </span>
          {plan.priceMinor > 0 && (
            <span className="text-xs text-muted-foreground ml-1">
              /{plan.interval}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Trial Active Banner */}
        {isTrialActive && (
          <Alert className="bg-blue-50/70 border-blue-200 text-blue-900">
            <Sparkles className="size-4 text-blue-600" />
            <AlertTitle className="text-sm font-semibold">
              Free Trial Active — {subscription.trialDaysRemaining} days remaining
            </AlertTitle>
            <AlertDescription className="text-xs text-blue-800 mt-1">
              Your workspace currently enjoys full access to the {plan.name} tier. When your trial ends on{' '}
              <span className="font-semibold">{formatDateDisplay(subscription.trialEndsAt)}</span>, your account will safely drop to Free limits with no data deleted.
            </AlertDescription>
          </Alert>
        )}

        {/* Trial Expired Banner */}
        {isTrialExpired && (
          <Alert variant="warning" className="bg-amber-50/80 border-amber-300 text-amber-950">
            <AlertTriangle className="size-4 text-amber-600" />
            <AlertTitle className="text-sm font-semibold">
              Your free trial has ended — Operating on Free tier limits
            </AlertTitle>
            <AlertDescription className="text-xs text-amber-900 mt-1">
              All your historical contacts, products, and messages remain completely safe. Upgrade to a paid plan below to restore multi-number WhatsApp access, higher automation limits, and AI capacity.
            </AlertDescription>
          </Alert>
        )}

        {/* Cancellation Pending Banner */}
        {isCanceledPending && (
          <Alert variant="destructive" className="bg-rose-50 border-rose-200 text-rose-950">
            <AlertCircle className="size-4 text-rose-600" />
            <AlertTitle className="text-sm font-semibold">
              Subscription cancellation scheduled
            </AlertTitle>
            <AlertDescription className="text-xs text-rose-900 mt-1">
              Your workspace retains full access to the {plan.name} plan until the current billing period ends on{' '}
              <span className="font-semibold">{formatDateDisplay(subscription.currentPeriodEnd)}</span>. After this date, your plan will switch to Free tier limits.
            </AlertDescription>
          </Alert>
        )}

        {/* Subscription Meta & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-border/60 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              <span>
                Current Period:{' '}
                <strong className="font-medium text-foreground">
                  {formatDateDisplay(subscription.currentPeriodStart)} – {formatDateDisplay(subscription.currentPeriodEnd)}
                </strong>
              </span>
            </div>
          </div>

          {canManage && !isFreePlan && (
            <div className="flex items-center gap-2">
              {isCanceledPending ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onResumeSubscription}
                  disabled={isActionLoading}
                  className="h-8 text-xs font-medium border-emerald-300 hover:bg-emerald-50 text-emerald-800"
                >
                  {isActionLoading && <Spinner className="mr-1.5 size-3" />}
                  Resume Subscription
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCancelSubscription}
                  disabled={isActionLoading}
                  className="h-8 text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40"
                >
                  {isActionLoading && <Spinner className="mr-1.5 size-3" />}
                  Cancel Subscription
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
