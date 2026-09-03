import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { Atmosphere } from '@/components/marketing/atmosphere';
import { Reveal } from '@/components/marketing/reveal';
import { SectionHeading } from '@/components/marketing/section-heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PLAN_KEYS, PLANS, type Plan } from '@/config/plans';
import { formatMoney, money } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * The pricing teaser: every figure read from `config/plans.ts`, none typed here.
 *
 * A landing page that quotes a price the plan catalogue no longer holds is a support ticket
 * waiting to happen, and there is no reason to accept that risk when the catalogue is one
 * import away.
 */

const TEASER_PLANS: readonly Plan[] = PLAN_KEYS.map((key) => PLANS[key])
  .filter((plan) => plan.isPublic)
  .sort((a, b) => a.position - b.position);

/** Grouped without `Intl`, so the server and the browser can never disagree. */
function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function aiAllowance(plan: Plan): string {
  const limit = plan.limits.aiRequestsPerMonth;
  return limit === null ? 'Unmetered AI replies' : `${groupThousands(limit)} AI replies a month`;
}

function priceLabel(plan: Plan): string {
  if (plan.priceMinor === 0) return 'Free';
  return formatMoney(money(plan.priceMinor, plan.currency));
}

export function PricingTeaser() {
  return (
    <section className="marketing-ink relative isolate overflow-hidden">
      <Atmosphere intensity="quiet" />

      <div className="container relative py-16 sm:py-20 lg:py-24">
        <Reveal>
          <SectionHeading
            eyebrow="Pricing"
            title="Start free. Pay once it is earning."
            lead={`One number and ${aiAllowance(PLANS.free)} cost nothing, for as long as you like. Paid plans come with a ${PLANS.starter.trialDays}-day trial and no card up front.`}
            align="center"
            className="mx-auto"
          />
        </Reveal>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TEASER_PLANS.map((plan, index) => {
            const isRecommended = plan.highlighted === true;

            return (
              <Reveal
                as="li"
                key={plan.key}
                delay={index * 70}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border bg-card p-5',
                  isRecommended ? 'marker-rail border-primary-border' : 'border-border',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{plan.name}</h3>
                  {isRecommended ? (
                    <Badge variant="default" size="sm">
                      Recommended
                    </Badge>
                  ) : null}
                </div>

                <p className="flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tabular-nums text-foreground">
                    {priceLabel(plan)}
                  </span>
                  {plan.priceMinor > 0 ? (
                    <span className="text-xs text-muted-foreground">/{plan.interval}</span>
                  ) : null}
                </p>

                <p className="text-sm leading-relaxed text-muted-foreground">{plan.tagline}</p>

                <p className="mt-auto pt-3 text-xs tabular-nums text-muted-foreground">
                  {aiAllowance(plan)}
                </p>
              </Reveal>
            );
          })}
        </ul>

        <Reveal delay={140} className="mt-10 flex flex-col items-center gap-3">
          <Button asChild size="lg" variant="outline" className="group">
            <Link href="/pricing">
              Compare every limit
              <ArrowRight
                className="size-4 transition-transform duration-fast ease-out group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Prices in Pakistani rupees. WhatsApp’s own conversation charges are billed by Meta.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
