import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ORDERED_PLANS, type Plan } from '@/config/plans';
import {
  HEADLINE_LIMIT_NAMES,
  formatLimitAllowance,
  limitLabelWithPeriod,
  planFeatureLabel,
} from '@/lib/labels';
import { formatMoney, money } from '@/lib/money';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple, honest pricing for ConvoNexa. Start free, then upgrade as your shop grows.',
};

/**
 * The trial length actually configured on the paid plans, rather than a number typed into the copy.
 *
 * The page used to say "14-day trial" in two places while the length lived in `config/plans.ts`.
 * A price page that quotes a term the product does not honour is the one kind of copy bug worth
 * engineering around.
 */
const TRIAL_DAYS = Math.max(
  0,
  ...ORDERED_PLANS.filter((plan) => plan.priceMinor > 0).map((plan) => plan.trialDays),
);

export default function PricingPage() {
  return (
    <div className="container py-16 lg:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Pricing that grows with you</h1>
        <p className="mt-4 max-w-prose text-lg leading-relaxed text-muted-foreground mx-auto">
          Start free on one WhatsApp number.
          {TRIAL_DAYS > 0
            ? ` Every paid plan begins with a ${TRIAL_DAYS}-day trial — no card needed to start.`
            : ' Upgrade whenever your shop is ready.'}
        </p>
      </div>

      {/* Two-up on a tablet rather than four-up: four of these at 1024px are ~230px wide, which
          wraps every limit row onto two lines. */}
      <ul className="mx-auto mt-14 grid max-w-6xl grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {ORDERED_PLANS.map((plan) => (
          <li key={plan.key} className="flex">
            <PlanCard plan={plan} />
          </li>
        ))}
      </ul>

      <p className="mx-auto mt-10 max-w-prose text-center text-sm text-muted-foreground">
        Billed monthly, cancel whenever you like. When you approach a limit we tell you well before
        anything stops — and we never delete your customers, orders or messages.
      </p>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const isRecommended = plan.highlighted === true;
  const isFree = plan.priceMinor === 0;

  return (
    <article
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-lg border bg-card',
        // The recommended plan is marked by its border and the rail on its leading edge — the same
        // signal the product uses — rather than by a badge floating over the border with a ring
        // behind it, which is the one arrangement every pricing template already has.
        isRecommended ? 'marker-rail border-primary-border' : 'border-border',
      )}
    >
      <header className="flex flex-col gap-3 p-5">
        <div className="flex min-h-6 flex-wrap items-center gap-2">
          <h2 className="text-md font-semibold tracking-tight">{plan.name}</h2>
          {isRecommended ? (
            <Badge variant="default" size="sm">
              Most chosen
            </Badge>
          ) : null}
        </div>

        <p className="flex items-baseline gap-1">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">
            {isFree ? 'Free' : formatMoney(money(plan.priceMinor, plan.currency))}
          </span>
          {isFree ? null : (
            <span className="text-sm text-muted-foreground">
              / {plan.interval === 'year' ? 'year' : 'month'}
            </span>
          )}
        </p>

        {/* A fixed two-line box, so prices and limits line up across all four cards. */}
        <p className="line-clamp-2 min-h-9 text-sm leading-snug text-muted-foreground">
          {plan.tagline}
        </p>

        <Button asChild className="mt-1 w-full" variant={isRecommended ? 'default' : 'outline'}>
          <Link href="/signup">
            {isFree || plan.trialDays === 0
              ? 'Start free'
              : `Start your ${plan.trialDays}-day trial`}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </header>

      <dl className="border-t border-border">
        {HEADLINE_LIMIT_NAMES.map((name) => (
          <div
            key={name}
            className="flex items-baseline justify-between gap-2 border-b border-border px-5 py-2.5"
          >
            <dt className="min-w-0 truncate text-sm text-muted-foreground">
              {limitLabelWithPeriod(name)}
            </dt>
            <dd className="shrink-0 font-mono text-sm font-medium tabular-nums">
              {formatLimitAllowance(name, plan.limits[name])}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <h3 className="eyebrow">Included</h3>
        <ul className="flex flex-col gap-2">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm leading-snug">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>{planFeatureLabel(feature)}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
