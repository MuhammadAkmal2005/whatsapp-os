import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * The button.
 *
 * Deliberately not marked `'use client'`. It holds no state and reads no browser API, and
 * almost every screen in the product renders one — the directive would drag this module, its
 * variant table and its icon into the client bundle of every route, including the ones that
 * are otherwise entirely server-rendered. A client parent passing `onClick` establishes the
 * boundary itself, which is where the boundary belongs.
 *
 * Three deliberate departures from the usual shadcn baseline, each for a reason.
 *
 * No shadow. A button is part of the page, not floating above it; depth here would
 * compete with the menus and dialogs that genuinely do float. Definition comes from
 * fill and border instead.
 *
 * No scale transform on press. A button that shrinks when clicked is a decorative tic
 * that also fights the pointer. The pressed state is an inset shadow and a darker fill —
 * the surface appears to depress, which is what a physical control does.
 *
 * No focus ring of its own. A single global `:focus-visible` outline in globals.css
 * serves the whole product, so adding one here would draw it twice.
 */
const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md',
    'font-medium transition-[background-color,border-color,color,box-shadow,opacity]',
    'duration-instant ease-out',
    'disabled:pointer-events-none disabled:opacity-45',
    // Icons inherit a consistent size and never shrink when the label wraps.
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4',
  ],
  {
    variants: {
      variant: {
        /* The one loud control on any given screen. There should rarely be two. */
        default: [
          'bg-primary text-primary-foreground',
          'hover:bg-primary-hover',
          'active:bg-primary-hover active:shadow-[inset_0_1px_3px_hsl(0_0%_0%/0.22)]',
        ],
        /* Tinted rather than solid: for a secondary action that still needs to read as
           belonging to the brand, like "Test the AI" beside a primary "Go live". */
        subtle: [
          'bg-primary-surface text-primary border border-primary-border',
          'hover:bg-primary-surface hover:border-primary',
          'active:shadow-[inset_0_1px_3px_hsl(0_0%_0%/0.1)]',
        ],
        secondary: [
          'bg-secondary text-secondary-foreground',
          'hover:bg-accent hover:text-accent-foreground',
          'active:shadow-[inset_0_1px_3px_hsl(0_0%_0%/0.1)]',
        ],
        outline: [
          'border border-input bg-card text-foreground',
          'hover:border-border-strong hover:bg-accent hover:text-accent-foreground',
          'active:shadow-[inset_0_1px_3px_hsl(0_0%_0%/0.08)]',
        ],
        ghost: [
          'text-foreground',
          'hover:bg-accent hover:text-accent-foreground',
          'active:bg-accent',
        ],
        destructive: [
          'bg-destructive text-destructive-foreground',
          'hover:bg-destructive-hover',
          'active:shadow-[inset_0_1px_3px_hsl(0_0%_0%/0.22)]',
        ],
        /* For a destructive action that is available but should not be inviting —
           "Delete product" sitting in a form beside "Save changes". */
        'destructive-outline': [
          'border border-destructive-border bg-card text-destructive',
          'hover:border-destructive hover:bg-destructive-surface',
          'active:shadow-[inset_0_1px_3px_hsl(0_0%_0%/0.08)]',
        ],
        link: 'text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary',
      },
      size: {
        sm: 'h-control-sm px-2.5 text-xs',
        default: 'h-control px-3.5 text-sm',
        lg: 'h-control-lg px-5 text-base',
        icon: 'size-control',
        'icon-sm': 'size-control-sm',
        'icon-lg': 'size-control-lg',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * Shows a spinner in place of the leading icon and blocks interaction.
     *
     * The label stays put rather than being replaced, so the button keeps its width and
     * the row it sits in does not reflow mid-action.
     */
    isLoading?: boolean;
  };

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, isLoading = false, children, disabled, ...props },
    ref,
  ) => {
    // `asChild` renders a Link or another element in place of the button, which cannot
    // also host a spinner without breaking Slot's single-child contract.
    if (asChild) {
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
