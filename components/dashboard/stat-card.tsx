import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type StatTone = 'default' | 'warning' | 'danger';

type StatCardProps = {
  label: string;
  /** Pre-formatted for display — money is formatted by the caller so the card
   *  never has to know about currency. */
  value: string;
  icon: LucideIcon;
  /** A short line of context under the value: a comparison, a total, a count. */
  hint?: string;
  /** When set, the whole card is a link to that screen. Omit for a metric whose
   *  destination screen does not exist yet — a card that links nowhere is worse
   *  than one that does not link. */
  href?: string;
  /** Draws the eye for a metric that wants action. Presentational only; the
   *  number is identical regardless of tone. */
  tone?: StatTone;
};

const iconBadgeStyles: Record<StatTone, string> = {
  default: 'bg-muted text-muted-foreground',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
};

const hintStyles: Record<StatTone, string> = {
  default: 'text-muted-foreground',
  warning: 'text-warning',
  danger: 'text-destructive',
};

/**
 * A single headline number on the dashboard. Server-rendered — it takes an icon
 * component directly because its only caller is the dashboard page, itself a
 * Server Component, so nothing crosses the client boundary.
 */
export function StatCard({ label, value, icon: Icon, hint, href, tone = 'default' }: StatCardProps) {
  const card = (
    <Card
      className={cn(
        'flex h-full flex-col p-5',
        href && 'transition-colors hover:border-primary/40 hover:bg-accent',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span
          aria-hidden
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            iconBadgeStyles[tone],
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-0.5">
        <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
        {hint ? <span className={cn('text-xs', hintStyles[tone])}>{hint}</span> : null}
      </div>
    </Card>
  );

  if (!href) return card;

  return (
    <Link
      href={href}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {card}
    </Link>
  );
}
