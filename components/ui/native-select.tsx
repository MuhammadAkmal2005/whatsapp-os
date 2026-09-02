import { ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';
import { fieldClassName } from '@/components/ui/input';

/**
 * A styled native `<select>`.
 *
 * The Radix `Select` is used where a picker needs rich content — group labels, checkmarks,
 * two-line options. Everywhere else, filters and simple form choices, a real `<select>` is
 * the better control: it costs no JavaScript, it opens the platform picker on a phone
 * (which is faster and more familiar than any custom sheet), and it is keyboard- and
 * screen-reader-correct without any work from us.
 *
 * Deliberately not marked `'use client'`. It holds no state and reads no browser API, so the
 * directive would only force the module into the client bundle of every route that renders a
 * filter bar. Every consumer that attaches an `onChange` is a client component already and
 * establishes the boundary itself.
 *
 * What it does not do well is look like the rest of the product, because the browser paints
 * its own arrow. So the arrow is suppressed and redrawn to match every other control — the
 * only thing this wrapper exists for.
 *
 * The wrapper is an `inline-grid` so that `wrapperClassName="w-auto"` produces a control
 * sized to its widest option, which is what a filter bar wants, while the default fills its
 * container, which is what a form wants.
 */
export type NativeSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  /** Class applied to the positioning wrapper rather than to the select itself. */
  wrapperClassName?: string;
};

const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => (
    <div className={cn('relative inline-grid w-full items-center', wrapperClassName)}>
      <select
        ref={ref}
        // `bg-none` matters: some browsers paint the arrow as a background image, which
        // `appearance-none` alone does not remove.
        className={cn(fieldClassName, 'h-control appearance-none bg-none pl-2.5 pr-8', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground"
        aria-hidden
      />
    </div>
  ),
);
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
