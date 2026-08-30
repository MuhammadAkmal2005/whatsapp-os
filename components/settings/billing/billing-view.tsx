'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  cancelSubscriptionAction,
  changePlanAction,
  fetchBillingOverviewAction,
  resumeSubscriptionAction,
} from '@/server/actions/subscription.actions';
import type { PlanKey } from '@/config/plans';
import type { WorkspaceBillingSummaryDTO } from '@/server/services/subscription/subscription.service';
import { CurrentPlanCard } from './current-plan-card';
import { PlanComparisonGrid } from './plan-comparison-grid';
import { UsageOverviewCard } from './usage-overview-card';

interface BillingViewProps {
  initialData: WorkspaceBillingSummaryDTO;
}

export function BillingView({ initialData }: BillingViewProps) {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceBillingSummaryDTO>(initialData);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [pendingPlanKey, setPendingPlanKey] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const refreshBillingData = async () => {
    const res = await fetchBillingOverviewAction();
    if (res.success) {
      setData(res.data);
    }
    router.refresh();
  };

  const handleSelectPlan = async (planKey: PlanKey) => {
    clearMessages();
    setIsActionLoading(true);
    setPendingPlanKey(planKey);

    try {
      const res = await changePlanAction({ planKey });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSuccess(`Plan successfully changed to ${res.data.plan.name}.`);
      await refreshBillingData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update plan.');
    } finally {
      setIsActionLoading(false);
      setPendingPlanKey(null);
    }
  };

  const handleCancelSubscription = async () => {
    if (!window.confirm('Are you sure you want to cancel your subscription at the end of the current billing period? You will retain access until the end date.')) {
      return;
    }

    clearMessages();
    setIsActionLoading(true);

    try {
      const res = await cancelSubscriptionAction();
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSuccess('Subscription scheduled for cancellation at the end of the billing period.');
      await refreshBillingData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel subscription.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResumeSubscription = async () => {
    clearMessages();
    setIsActionLoading(true);

    try {
      const res = await resumeSubscriptionAction();
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSuccess('Subscription successfully resumed.');
      await refreshBillingData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resume subscription.');
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alert Messages */}
      {error && (
        <Alert variant="destructive" className="border-rose-200 bg-rose-50 text-rose-950">
          <AlertCircle className="size-4 text-rose-600" />
          <AlertTitle className="text-sm font-semibold">Error</AlertTitle>
          <AlertDescription className="text-xs text-rose-900 mt-0.5">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
          <CheckCircle2 className="size-4 text-emerald-600" />
          <AlertTitle className="text-sm font-semibold">Success</AlertTitle>
          <AlertDescription className="text-xs text-emerald-900 mt-0.5">
            {success}
          </AlertDescription>
        </Alert>
      )}

      {/* Current Active Plan Details */}
      <CurrentPlanCard
        billing={data}
        onCancelSubscription={handleCancelSubscription}
        onResumeSubscription={handleResumeSubscription}
        isActionLoading={isActionLoading}
      />

      {/* Quota & Usage Metering Overview */}
      <UsageOverviewCard quotaUsage={data.quotaUsage} />

      {/* Plan Catalogue & Upgrade Grid */}
      <PlanComparisonGrid
        plans={data.allPlans}
        activePlanKey={data.subscription.effectivePlanKey}
        canManage={data.canManage}
        onSelectPlan={handleSelectPlan}
        isActionLoading={isActionLoading}
        pendingPlanKey={pendingPlanKey}
      />
    </div>
  );
}
