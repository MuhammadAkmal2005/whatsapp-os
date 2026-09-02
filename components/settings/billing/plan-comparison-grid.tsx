'use client';

import { Check } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import type { Plan, PlanKey } from '@/config/plans';
import type { FormState } from '@/lib/form-state';
import {
  HEADLINE_LIMIT_NAMES,
  formatLimitAllowance,
  limitLabelWithPeriod,
  planFeatureLabel,
} from '@/lib/labels';
import { formatMoney, money } from '@/lib/money';
import { cn } from '@/lib/utils';

interface PlanComparisonGridProps {
  plans: Plan[];
  activePlanKey: PlanKey;
  canManage: boolean;
  /** The outcome of the last plan change, shown beside the buttons that cause it. */
  feedback: FormState;
  onSelectPlan: (planKey: PlanKey) => Promise<void>;
  /** Any billing action is in flight — every plan button waits for it. */
  isBusy: boolean;
  pendingPlanKey: PlanKey | null;
}

/**
 * The plans this workspace can move to.
 *
 * Rebuilt from four boxes that each shouted at once: a floating "Most Popular" badge overlapping
 * the border, a ring, a tinted background on the current plan, ticks in one green and a trial note
 * in a different blue, and a "Current Plan" button that was permanently disabled — a control that
 * exists only to be unclickable. None of the tints had a dark-mode counterpart.
 *
 * Now the cards are quiet and the two things worth knowing are carried structurally: the plan you
 * are on wears the marker rail down its leading edge, the same signal the sidebar uses for the page
 * you are on, and the recommended plan is the only one with a coloured border. Everything else is
 * the same neutral surface, so the differences a reader is actually comparing — the numbers — are
 * the loudest thing on the row.
 */
export function PlanComparisonGrid({
  plans,
  activePlanKey,
  canManage,
  feedback,
  onSelectPlan,
  isBusy,
  pendingPlanKey,
}: PlanComparisonGridProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold leading-snug tracking-tight">Change your plan</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          {canManage
            ? 'Moving between plans takes effect straight away. Your customers, products, orders and messages are never removed when a plan changes — only the limits above move.'
            : 'Only the workspace owner can change the plan. You can see what each one includes here.'}
        </p>
      </div>

      {/* Beside the buttons that produce it. A plan switched from the bottom of a long page used
          to report itself in a strip at the top, well out of view. */}
      <FormAlert state={feedback} successTitle="Plan updated" />

      {/* Two-up on a tablet rather than four-up: at 1024px four of these are 230px wide, which
          turns every limit row into two lines. */}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <li key={plan.key} className="flex">
            <PlanCard
              plan={plan}
              isCurrent={plan.key === activePlanKey}
              canManage={canManage}
              isPending={pendingPlanKey === plan.key}
              isBusy={isBusy}
              onSelect={onSelectPlan}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanCard({
  plan,
  isCurrent,
  canManage,
  isPending,
  isBusy,
  onSelect,
}: {
  plan: Plan;
  isCurrent: boolean;
  canManage: boolean;
  isPending: boolean;
  isBusy: boolean;
  onSelect: (planKey: PlanKey) => Promise<void>;
}) {
  const isPaid = plan.priceMinor > 0;

  return (
    <article
      className={cn(
        'relative flex w-full flex-col overflow-hidden rounded-lg border bg-card',
        isCurrent && 'marker-rail',
        plan.highlighted && !isCurrent ? 'border-primary-border' : 'border-border',
      )}
    >
      <header className="flex flex-col gap-3 px-4 pb-4 pt-4">
        <div className="flex min-h-6 flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight">{plan.name}</h3>
          {isCurrent ? (
            <Badge variant="success" size="sm" dot>
              Your plan
            </Badge>
          ) : plan.highlighted ? (
            <Badge variant="default" size="sm">
              Most chosen
            </Badge>
          ) : null}
        </div>

        <p className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {isPaid ? formatMoney(money(plan.priceMinor, plan.currency)) : 'Free'}
          </span>
          {isPaid ? (
            <span className="text-xs text-muted-foreground">
              / {plan.interval === 'year' ? 'year' : 'month'}
            </span>
          ) : null}
        </p>

        {/* A fixed two-line box, so the price and the limits below line up across all four
            cards regardless of how long each tagline runs. */}
        <p className="line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">
          {plan.tagline}
        </p>
      </header>

      <dl className="border-t border-border">
        {HEADLINE_LIMIT_NAMES.map((name) => (
          <div
            key={name}
            className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-2"
          >
            <dt className="min-w-0 truncate text-xs text-muted-foreground">
              {limitLabelWithPeriod(name)}
            </dt>
            <dd className="shrink-0 font-mono text-xs font-medium tabular-nums">
              {formatLimitAllowance(name, plan.limits[name])}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-1 flex-col gap-2 px-4 py-3.5">
        <h4 className="eyebrow">Included</h4>
        <ul className="flex flex-col gap-1.5">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-xs leading-4">
              <Check className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
              <span>{planFeatureLabel(feature)}</span>
            </li>
          ))}
        </ul>
      </div>

      <footer className="border-t border-border bg-surface-sunken px-4 py-3">
        {isCurrent ? (
          // No button here. A permanently disabled "Current Plan" control is a promise of an
          // action that does not exist; the rail and the chip already say where you are.
          <p className="text-xs text-muted-foreground">
            {plan.trialDays > 0 && isPaid
              ? `Includes a ${plan.trialDays}-day free trial`
              : 'You are on this plan'}
          </p>
        ) : (
          <Button
            variant={plan.highlighted ? 'default' : 'outline'}
            size="sm"
            className="w-full"
            disabled={!canManage || (isBusy && !isPending)}
            isLoading={isPending}
            onClick={() => onSelect(plan.key)}
          >
            {isPaid ? `Switch to ${plan.name}` : 'Move to Free'}
          </Button>
        )}
      </footer>
    </article>
  );
}
