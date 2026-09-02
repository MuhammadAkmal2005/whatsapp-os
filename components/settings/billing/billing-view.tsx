'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PlanKey } from '@/config/plans';
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state';
import {
  cancelSubscriptionAction,
  changePlanAction,
  fetchBillingOverviewAction,
  resumeSubscriptionAction,
} from '@/server/actions/subscription.actions';
import type { WorkspaceBillingSummaryDTO } from '@/server/services/subscription/subscription.service';

import { CurrentPlanCard } from './current-plan-card';
import { PlanComparisonGrid } from './plan-comparison-grid';
import { UsageOverviewCard } from './usage-overview-card';

interface BillingViewProps {
  initialData: WorkspaceBillingSummaryDTO;
}

/** Which action is in flight, so only the button that was pressed shows a spinner. */
type PendingAction = 'plan' | 'cancel' | 'resume' | null;

/**
 * Which part of the screen an outcome belongs to.
 *
 * Every message used to render in one strip at the very top. On a screen this tall that put the
 * result of pressing "Switch to Business" — a button near the bottom of the page — outside the
 * viewport, so the action appeared to do nothing at all.
 */
type FeedbackScope = 'subscription' | 'plan';

export function BillingView({ initialData }: BillingViewProps) {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceBillingSummaryDTO>(initialData);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingPlanKey, setPendingPlanKey] = useState<PlanKey | null>(null);
  const [scope, setScope] = useState<FeedbackScope>('plan');
  const [feedback, setFeedback] = useState<FormState>(IDLE_FORM_STATE);

  const isBusy = pendingAction !== null;

  const begin = (action: Exclude<PendingAction, null>, forScope: FeedbackScope) => {
    setFeedback(IDLE_FORM_STATE);
    setScope(forScope);
    setPendingAction(action);
  };

  /**
   * Pulls the summary again and re-renders the server tree. Returns whether the fresh numbers
   * actually arrived — a failed refresh used to be swallowed, which left the old figures on screen
   * under a success message.
   */
  const refreshBillingData = async (): Promise<boolean> => {
    const res = await fetchBillingOverviewAction();
    if (res.success) {
      setData(res.data);
    }
    router.refresh();
    return res.success;
  };

  const succeed = async (message: string) => {
    const fresh = await refreshBillingData();

    setFeedback({
      status: 'success',
      message: fresh
        ? message
        : `${message} The figures on this page could not be reloaded — refresh to see them update.`,
    });
  };

  const handleSelectPlan = async (planKey: PlanKey) => {
    begin('plan', 'plan');
    setPendingPlanKey(planKey);

    // The plan's own name, not its key. This message used to read "Plan successfully changed to
    // business", which is the string the database stores, not the one on the pricing page.
    const planName = data.allPlans.find((plan) => plan.key === planKey)?.name ?? planKey;

    try {
      const res = await changePlanAction({ planKey });
      if (!res.success) {
        setFeedback({ status: 'error', message: res.error });
        return;
      }

      if (res.data?.redirectUrl) {
        window.location.href = res.data.redirectUrl;
        return;
      }

      await succeed(`You are now on ${planName}. Your new limits apply straight away.`);
    } catch {
      setFeedback({
        status: 'error',
        message: 'We could not change your plan just now. Please try again in a moment.',
      });
    } finally {
      setPendingAction(null);
      setPendingPlanKey(null);
    }
  };

  const handleCancelSubscription = async (): Promise<boolean> => {
    begin('cancel', 'subscription');

    try {
      const res = await cancelSubscriptionAction();
      if (!res.success) {
        setFeedback({ status: 'error', message: res.error });
        return false;
      }

      await succeed(
        'Your subscription will not renew. You keep everything until the end of the current billing period.',
      );
      return true;
    } catch {
      setFeedback({
        status: 'error',
        message: 'We could not cancel your subscription just now. Please try again in a moment.',
      });
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const handleResumeSubscription = async (): Promise<boolean> => {
    begin('resume', 'subscription');

    try {
      const res = await resumeSubscriptionAction();
      if (!res.success) {
        setFeedback({ status: 'error', message: res.error });
        return false;
      }

      await succeed('Your subscription will renew as normal. Nothing changes for your workspace.');
      return true;
    } catch {
      setFeedback({
        status: 'error',
        message: 'We could not resume your subscription just now. Please try again in a moment.',
      });
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <CurrentPlanCard
        billing={data}
        feedback={scope === 'subscription' ? feedback : IDLE_FORM_STATE}
        onCancelSubscription={handleCancelSubscription}
        onResumeSubscription={handleResumeSubscription}
        isCancelling={pendingAction === 'cancel'}
        isResuming={pendingAction === 'resume'}
        isBusy={isBusy}
      />

      <UsageOverviewCard quotaUsage={data.quotaUsage} />

      <PlanComparisonGrid
        plans={data.allPlans}
        activePlanKey={data.subscription.effectivePlanKey}
        canManage={data.canManage}
        feedback={scope === 'plan' ? feedback : IDLE_FORM_STATE}
        onSelectPlan={handleSelectPlan}
        isBusy={isBusy}
        pendingPlanKey={pendingPlanKey}
      />
    </div>
  );
}
