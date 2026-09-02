import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Figures, presented as a set.
 *
 * A `Stat` is a cell inside a `StatBand`, never a card of its own. That distinction is the
 * whole point. Four bordered, shadowed cards in a row read as four separate objects each
 * asking for attention; four cells sharing one surface read as one set of related numbers,
 * which is what they are. It also takes three borders out of the top of the screen, where
 * a reader is trying to get their bearings.
 *
 * There is deliberately no icon and no colour. A wallet glyph beside "Revenue this month"
 * repeats what the label already said, and an amber figure implies something is wrong when
 * nothing is. Numbers that need action are not statistics — they belong in a list of
 * things to do, where the row can be clicked and the tone means something.
 */

const COLUMNS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
} as const;

export type StatBandProps = {
  /** How many cells sit side by side at the widest breakpoint. Always one on mobile. */
  columns?: keyof typeof COLUMNS;
  /** Names the set for assistive technology, e.g. "Key figures". */
  label: string;
  children: React.ReactNode;
  className?: string;
};

export function StatBand({ columns = 3, label, children, className }: StatBandProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <section aria-label={label} className={cn('grid grid-cols-1', COLUMNS[columns])}>
        {children}
      </section>
    </Card>
  );
}

export type StatProps = {
  label: string;
  /**
   * Pre-formatted for display. Money is formatted by the caller, so the cell never has to
   * know about currency.
   *
   * An element is allowed where the figure is a *state* rather than a number — a stock
   * badge, a price with its struck-through original. Anything passed in brings its own
   * size and weight, which overrides the inherited figure styling below. Do not use it to
   * put an icon beside a plain number; see the note at the top of this file.
   */
  value: React.ReactNode;
  /** One short line of context: a comparison, a total, what the figure excludes. */
  hint?: string;
  /** When set, the whole cell links there. Omit it when no screen shows exactly this
   *  figure — a stat that links to an approximation is worse than one that does not link,
   *  because the reader trusts the count and then cannot find it. */
  href?: string;
  /** The band's headline figure. One per band at most; more than one is no hierarchy. */
  emphasis?: 'lead';
  className?: string;
};

export function Stat({ label, value, hint, href, emphasis, className }: StatProps) {
  const isLead = emphasis === 'lead';

  const body = (
    <>
      <span className="eyebrow flex items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        {href ? (
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-fast ease-out group-hover:translate-x-0.5 group-hover:text-muted-foreground"
          />
        ) : null}
      </span>
      <span
        className={cn(
          'font-semibold tabular-nums tracking-tight text-foreground',
          isLead ? 'text-3xl' : 'text-xl',
        )}
      >
        {value}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </>
  );

  // Every cell draws its own leading hairlines and pulls them a pixel outside itself, so
  // the ones on the band's outer edge are clipped by the card and only the interior rules
  // survive. Two alternatives were wrong: `divide-x` places its rule with `> * + *`, which
  // lands in the wrong cell as soon as one spans several columns; and a `gap-px` over a
  // border-coloured background leaves a stray strip of colour whenever the last row is
  // short of a full set. This is correct for any cell count, any span, any breakpoint.
  const cellStyles = cn(
    '-ml-px -mt-px flex flex-col gap-1.5 border-l border-t border-border bg-card px-5',
    isLead ? 'py-5' : 'py-4',
    className,
  );

  if (!href) {
    return <div className={cellStyles}>{body}</div>;
  }

  return (
    <Link
      href={href}
      // The link is the cell, so the hover target is the whole rectangle rather than the
      // label — a figure you can see is a figure you expect to be able to click.
      className={cn(
        cellStyles,
        'group transition-colors duration-instant ease-out hover:bg-surface-selected',
      )}
    >
      {body}
    </Link>
  );
}
