import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * A panel of related content.
 *
 * No shadow. Depth in this product comes from the value step between the page ground and
 * the card surface, plus a hairline border — which means a screen with fourteen cards on
 * it reads as a structured page rather than as a pile of floating rectangles. Shadow is
 * reserved for layers that genuinely float above the page: menus, popovers, dialogs.
 *
 * One surface, no variants. A card is the raised level of the hierarchy; the sunken level is
 * `bg-surface-sunken`, which appears inside a card — as a `CardFooter`, a `TableHead` band, an
 * `EmptyState` well, a note in a list — and never as the card itself. Offering a `sunken` card
 * would give the product two ways to draw the same well and no rule for choosing between them.
 */
const Card = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 px-5 pb-4 pt-5', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

/**
 * A header row that carries actions on the trailing edge. Wraps to two rows on narrow
 * screens rather than crushing the title, which is what a plain flex row would do.
 */
const CardToolbar = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-3 px-5 pb-4 pt-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
        className,
      )}
      {...props}
    />
  ),
);
CardToolbar.displayName = 'CardToolbar';

/**
 * A card's title, and a real `h2`.
 *
 * A card is a section of a page, and the page's own title is the `h1` in `PageHeader`, so `h2`
 * is the level that makes the document outline match what the reader sees. It used to be `h3`,
 * which skipped a level everywhere and — worse — collided with the hand-written `h2` headings
 * that a few panels use instead of a card header, so two peer panels sat at different depths.
 * Headings nested inside a card start at `h3`.
 */
const CardTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn('text-base font-semibold leading-snug tracking-tight', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('max-w-prose text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-5 pb-5', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

/**
 * A footer separated by a rule and set on the sunken surface, so an action bar reads as
 * distinct from the content it acts on instead of merging into it.
 */
const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-2 rounded-b-lg border-t border-border bg-surface-sunken px-5 py-3.5',
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardHeader,
  CardToolbar,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
