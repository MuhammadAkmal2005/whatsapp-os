'use client';

import { useState } from 'react';
import { AlertCircle, AlertTriangle, Sparkles } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle, CardToolbar } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import type { FormState } from '@/lib/form-state';
import { formatMoney, money } from '@/lib/money';
import type { WorkspaceBillingSummaryDTO } from '@/server/services/subscription/subscription.service';

/** Resolves to whether the change went through, so a confirmation can stay open on failure. */
type BillingAction = () => Promise<boolean>;

interface CurrentPlanCardProps {
  billing: WorkspaceBillingSummaryDTO;
  /** The outcome of the last cancel or resume, shown beside the button that caused it. */
  feedback: FormState;
  onCancelSubscription: BillingAction;
  onResumeSubscription: BillingAction;
  isCancelling: boolean;
  isResuming: boolean;
  /** Any billing action is in flight, including a plan change elsewhere on the page. */
  isBusy: boolean;
}

/**
 * What the workspace is on today, and the one thing that might need attention about it.
 *
 * The three status banners used to be three independent conditions, each with its own
 * hand-mixed palette — `bg-blue-50/70`, `bg-amber-50/80`, `bg-rose-50` — none of which had a
 * dark-mode counterpart, so on an ink page they rendered as three pale slabs with pale text on
 * them. They are now one derived state drawn on the semantic alert surfaces, and only the most
 * urgent one shows: a pending cancellation matters more than an expired trial, which matters
 * more than a trial that is still running.
 *
 * The price also follows the plan's own currency. It was formatted as rupees regardless, which
 * quoted the wrong number to a seller billed in dirhams.
 */
export function CurrentPlanCard({
  billing,
  feedback,
  onCancelSubscription,
  onResumeSubscription,
  isCancelling,
  isResuming,
  isBusy,
}: CurrentPlanCardProps) {
  const { subscription, plan, canManage } = billing;

  const isTrialActive = subscription.isTrial && !subscription.isTrialExpired;
  const isFreePlan = subscription.planKey === 'free' || plan.key === 'free';
  const isPaid = plan.priceMinor > 0;

  return (
    <Card>
      <CardToolbar>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg">{plan.name}</CardTitle>
            <PlanStatusBadge subscription={subscription} />
          </div>
          <CardDescription className="mt-1">{plan.tagline}</CardDescription>
        </div>

        <p className="flex shrink-0 items-baseline gap-1 sm:justify-end">
          <span className="text-xl font-semibold tracking-tight tabular-nums">
            {isPaid ? formatMoney(money(plan.priceMinor, plan.currency)) : 'Free'}
          </span>
          {isPaid ? (
            <span className="text-sm text-muted-foreground">
              / {plan.interval === 'year' ? 'year' : 'month'}
            </span>
          ) : null}
        </p>
      </CardToolbar>

      <CardContent className="flex flex-col gap-4">
        <PlanStatusNotice billing={billing} />

        <FormAlert state={feedback} successTitle="Subscription updated" />

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {isTrialActive ? 'Trial runs to' : 'Billing period'}{' '}
            <span className="font-medium text-foreground">
              {isTrialActive
                ? formatDate(subscription.trialEndsAt)
                : `${formatDate(subscription.currentPeriodStart)} – ${formatDate(subscription.currentPeriodEnd)}`}
            </span>
          </p>

          {canManage && !isFreePlan ? (
            subscription.cancelAtPeriodEnd ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onResumeSubscription}
                isLoading={isResuming}
                disabled={isBusy && !isResuming}
              >
                Keep my subscription
              </Button>
            ) : (
              <CancelSubscriptionDialog
                planName={plan.name}
                endsOn={formatDate(subscription.currentPeriodEnd)}
                onConfirm={onCancelSubscription}
                isCancelling={isCancelling}
                isBusy={isBusy}
              />
            )
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Confirms a cancellation before it happens.
 *
 * This was a `window.confirm` — a browser chrome box that cannot be styled, cannot be read by the
 * page's own voice, and blocks the main thread. It also asked "Are you sure?", which tells the
 * reader nothing they need: what matters is that access continues to a specific date and that no
 * data is removed.
 */
function CancelSubscriptionDialog({
  planName,
  endsOn,
  onConfirm,
  isCancelling,
  isBusy,
}: {
  planName: string;
  endsOn: string;
  onConfirm: BillingAction;
  isCancelling: boolean;
  isBusy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasEndDate = endsOn !== '—';

  const confirm = async () => {
    const ok = await onConfirm();
    // Left open on failure so the reason is read next to the button that can be pressed again.
    if (ok) setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive-outline" disabled={isBusy}>
          Cancel subscription
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-form">
        <DialogHeader>
          <DialogTitle>Stop your {planName} subscription?</DialogTitle>
          <DialogDescription>
            {hasEndDate
              ? `You keep every ${planName} feature until ${endsOn}, the end of the period you have already paid for. After that your workspace moves to the Free plan limits.`
              : `You keep every ${planName} feature until the end of the period you have already paid for. After that your workspace moves to the Free plan limits.`}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Nothing is deleted. Your customers, products, orders, conversations and knowledge all
          stay exactly as they are, and you can start a plan again whenever you want.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isCancelling}>
            Keep my subscription
          </Button>
          <Button variant="destructive" onClick={confirm} isLoading={isCancelling}>
            {hasEndDate ? `Stop on ${endsOn}` : 'Stop at period end'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Subscription = WorkspaceBillingSummaryDTO['subscription'];

function PlanStatusBadge({ subscription }: { subscription: Subscription }) {
  if (subscription.cancelAtPeriodEnd) {
    return (
      <Badge variant="danger" dot>
        Ending soon
      </Badge>
    );
  }

  if (subscription.isTrialExpired) {
    return (
      <Badge variant="warning" dot>
        Trial ended
      </Badge>
    );
  }

  if (subscription.isTrial) {
    const days = subscription.trialDaysRemaining ?? 0;
    return (
      <Badge variant="info" dot>
        {days === 1 ? 'Trial · 1 day left' : `Trial · ${days} days left`}
      </Badge>
    );
  }

  if (subscription.status === 'ACTIVE') {
    return (
      <Badge variant="success" dot>
        Active
      </Badge>
    );
  }

  if (subscription.status === 'PAST_DUE') {
    return (
      <Badge variant="warning" dot>
        Payment due
      </Badge>
    );
  }

  return null;
}

/**
 * The one banner worth a shop owner's attention, in order of urgency. Returns nothing on a
 * healthy paid plan — an alert that says "everything is fine" trains people to skip alerts.
 */
function PlanStatusNotice({ billing }: { billing: WorkspaceBillingSummaryDTO }) {
  const { subscription, plan } = billing;

  if (subscription.cancelAtPeriodEnd) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>Your subscription ends on {formatDate(subscription.currentPeriodEnd)}</AlertTitle>
        <AlertDescription>
          You keep everything on {plan.name} until then. After that your workspace moves to the
          Free limits. Nothing is deleted — your customers, products and messages all stay.
        </AlertDescription>
      </Alert>
    );
  }

  if (subscription.isTrialExpired) {
    return (
      <Alert variant="warning">
        <AlertTriangle aria-hidden />
        <AlertTitle>Your free trial has ended</AlertTitle>
        <AlertDescription>
          Your workspace is running on the Free limits. Everything you added during the trial is
          still here. Choose a plan below to get your extra WhatsApp numbers, higher AI capacity
          and automation limits back.
        </AlertDescription>
      </Alert>
    );
  }

  if (subscription.isTrial) {
    return (
      <Alert variant="info">
        <Sparkles aria-hidden />
        <AlertTitle>
          You have full {plan.name} access until {formatDate(subscription.trialEndsAt)}
        </AlertTitle>
        <AlertDescription>
          When the trial ends your workspace moves to the Free limits on its own. Nothing is
          deleted and you are not charged unless you choose a plan.
        </AlertDescription>
      </Alert>
    );
  }

  if (subscription.status === 'PAST_DUE') {
    return (
      <Alert variant="warning">
        <AlertTriangle aria-hidden />
        <AlertTitle>We could not take your last payment</AlertTitle>
        <AlertDescription>
          Your {plan.name} features are still on for now. Update your payment details to keep them.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}

/** A date a person would read out. Falls back to a dash rather than "N/A". */
function formatDate(iso: string | null): string {
  if (!iso) return '—';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
