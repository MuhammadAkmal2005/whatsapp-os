import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMoney, money } from '@/lib/money';
import { ORDERED_PLANS, type Plan, type PlanFeature, type PlanLimits } from '@/config/plans';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple, honest pricing for WhatsApp OS. Start free, then upgrade as your shop grows.',
};

/** Shop-owner wording for each entitlement flag. */
const FEATURE_LABELS: Record<PlanFeature, string> = {
  ai_agent: 'AI employee',
  knowledge_base: 'Knowledge base',
  human_handoff: 'Human handoff',
  automations: 'Automations',
  analytics: 'Analytics',
  advanced_analytics: 'Advanced analytics',
  multiple_numbers: 'Multiple WhatsApp numbers',
  campaigns: 'Campaigns',
  appointments: 'Appointments',
  api_access: 'API access',
  priority_support: 'Priority support',
  audit_log_export: 'Audit log export',
};

/** The handful of limits worth showing on a card, in the order they read best. */
const HEADLINE_LIMITS: { key: keyof PlanLimits; label: string }[] = [
  { key: 'aiRequestsPerMonth', label: 'AI replies / month' },
  { key: 'teamMembers', label: 'Team members' },
  { key: 'contacts', label: 'Customers' },
  { key: 'whatsappNumbers', label: 'WhatsApp numbers' },
];

function formatLimit(value: number | null): string {
  return value === null ? 'Unlimited' : value.toLocaleString('en-US');
}

export default function PricingPage() {
  return (
    <div className="container py-16 lg:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Pricing that grows with you</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Start free on one WhatsApp number. Every paid plan includes a 14-day trial — no card
          needed to begin.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-6xl gap-6 lg:grid-cols-4">
        {ORDERED_PLANS.map((plan) => (
          <PlanCard key={plan.key} plan={plan} />
        ))}
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted-foreground">
        All prices in Pakistani Rupees, billed monthly. Approaching a limit? We warn you well before
        anything stops — we never delete your data.
      </p>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const isHighlighted = plan.highlighted === true;
  const isFree = plan.priceMinor === 0;
  const price = formatMoney(money(plan.priceMinor, plan.currency));

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl border bg-card p-6',
        isHighlighted ? 'border-primary shadow-lg ring-1 ring-primary' : 'border-border',
      )}
    >
      {isHighlighted && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most popular</Badge>
      )}

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        <p className="min-h-10 text-sm text-muted-foreground">{plan.tagline}</p>
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        {isFree ? (
          <span className="text-3xl font-semibold tracking-tight">Free</span>
        ) : (
          <>
            <span className="text-3xl font-semibold tracking-tight">{price}</span>
            <span className="text-sm text-muted-foreground">/month</span>
          </>
        )}
      </div>

      <Button
        asChild
        className="mt-6"
        variant={isHighlighted ? 'default' : 'outline'}
      >
        <Link href="/signup">
          {isFree ? 'Start free' : 'Start 14-day trial'}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>

      <dl className="mt-6 flex flex-col gap-2 border-t border-border pt-6">
        {HEADLINE_LIMITS.map((item) => (
          <div key={item.key} className="flex items-center justify-between text-sm">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="font-medium tabular-nums">{formatLimit(plan.limits[item.key])}</dd>
          </div>
        ))}
      </dl>

      <ul className="mt-6 flex flex-col gap-2.5 border-t border-border pt-6">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{FEATURE_LABELS[feature]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
