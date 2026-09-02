import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * A status chip.
 *
 * Squared rather than pill-shaped by default. A pill reads as marketing; a slightly
 * squared chip reads as a field value, which is what a status actually is in an order
 * book or a conversation list. The `pill` shape stays available for counts, where a
 * circular form is the right idiom.
 *
 * Every variant is built from a semantic surface/border/foreground triple rather than
 * from alpha compositing over an unknown background. Alpha was the reason status chips
 * turned to mud in dark mode: `bg-success/10` over ink is nearly black.
 */
const badgeVariants = cva(
  [
    'inline-flex shrink-0 items-center gap-1.5 border font-medium',
    'transition-colors duration-instant ease-out',
    'whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default: 'border-primary-border bg-primary-surface text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border bg-transparent text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-success-border bg-success-surface text-success',
        warning: 'border-warning-border bg-warning-surface text-warning',
        danger: 'border-destructive-border bg-destructive-surface text-destructive',
        info: 'border-info-border bg-info-surface text-info',
        /* Marks something the AI did or is responsible for. Its own hue, so an
           AI-handled conversation is never mistaken for a successful one. */
        ai: 'border-ai-border bg-ai-surface text-ai',
      },
      size: {
        sm: 'px-1.5 py-px text-3xs',
        default: 'px-2 py-0.5 text-2xs',
        lg: 'px-2.5 py-1 text-xs',
      },
      shape: {
        default: 'rounded-xs',
        pill: 'rounded-full',
      },
    },
    defaultVariants: { variant: 'default', size: 'default', shape: 'default' },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & {
    /**
     * Prefixes the label with a small filled disc in the chip's own colour.
     *
     * For lifecycle states — open, pending, resolved — where the dot gives the eye
     * something to track down a column faster than it can read the words.
     */
    dot?: boolean;
  };

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, shape, dot = false, children, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size, shape }), className)} {...props}>
      {dot ? (
        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      ) : null}
      {children}
    </span>
  ),
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
