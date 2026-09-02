import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The dashboard's list of things waiting on a person.
 *
 * Shaped as a list rather than a grid of cards, and placed above the figures, because a
 * dashboard answers two different questions and they are not equally urgent: *what needs
 * me?* comes before *how are we doing?*. Previously both were rendered with the same card,
 * which meant an unshipped order looked exactly like a neutral count of customers.
 *
 * Every row is an action, so a row links to the screen that shows precisely these records
 * where such a screen exists — and does not link where the closest filter would show a
 * different set. A count you can click and then cannot reconcile is worse than a count you
 * cannot click at all.
 *
 * The whole block is absent when there is nothing to act on. It never renders a row of
 * reassuring zeros dressed up as alerts.
 */

export type AttentionTone = 'warning' | 'danger';

export type AttentionItem = {
  label: string;
  count: number;
  /** What the number means, in the words a shop owner would use. */
  detail: string;
  icon: LucideIcon;
  tone: AttentionTone;
  href?: string;
};

const TONE_CHIP: Record<AttentionTone, string> = {
  warning: 'bg-warning-surface text-warning',
  danger: 'bg-destructive-surface text-destructive',
};

export function NeedsAttention({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      {/* A sunken strip rather than a CardHeader: this panel is a worklist, and giving it
          the same weight of title as "Recent activity" would make an alert compete with a
          feed. The heading stays a real h2 so the page outline is intact. */}
      <h2 className="eyebrow border-b border-border bg-surface-sunken px-5 py-2.5">
        Needs your attention
      </h2>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.label}>
            <AttentionRow item={item} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = item.icon;

  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          TONE_CHIP[item.tone],
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{item.label}</span>
        <span className="text-xs text-muted-foreground">{item.detail}</span>
      </span>
      <span className="shrink-0 text-lg font-semibold tabular-nums text-foreground">
        {item.count.toLocaleString()}
      </span>
      {item.href ? (
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground/50 transition-transform duration-fast ease-out group-hover:translate-x-0.5 group-hover:text-muted-foreground"
        />
      ) : (
        // Holds the chevron's place so the column of counts stays aligned whether or not
        // a row happens to link somewhere.
        <span aria-hidden className="size-4 shrink-0" />
      )}
    </>
  );

  const rowStyles = 'flex items-center gap-3 px-5 py-3';

  if (!item.href) {
    return <div className={rowStyles}>{body}</div>;
  }

  return (
    <Link
      href={item.href}
      className={cn(rowStyles, 'group transition-colors duration-instant ease-out hover:bg-muted')}
    >
      {body}
    </Link>
  );
}
