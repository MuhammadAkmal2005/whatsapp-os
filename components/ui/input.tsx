import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared field chrome for text inputs, textareas and native selects, so the three
 * cannot drift apart. Anything that looks like a field in this product uses this string.
 *
 * Two details worth knowing.
 *
 * The base size is 16px and only drops to 13px from `sm` up. iOS zooms the viewport when
 * a focused field's text is under 16px, which on a phone throws the user out of the
 * layout mid-form; the desktop density we want is simply not safe on mobile.
 *
 * There is no focus ring here and no `outline-none`. The global `:focus-visible` rule in
 * globals.css draws one outline for the entire product; a second ring on the field was
 * rendering both at once.
 */
export const fieldClassName = cn(
  'flex w-full rounded-md border border-input bg-card text-md text-foreground sm:text-sm',
  'transition-[border-color,background-color] duration-instant ease-out',
  'placeholder:text-muted-foreground',
  'hover:border-border-strong',
  'focus-visible:border-primary',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
  // A read-only field is still readable and selectable — it just cannot be edited, so it
  // gets the sunken surface rather than the disabled treatment.
  'read-only:bg-surface-sunken read-only:hover:border-input',
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:hover:border-destructive',
);

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        fieldClassName,
        'h-control px-2.5 py-1',
        'file:mr-3 file:h-full file:cursor-pointer file:border-0 file:bg-transparent file:p-0 file:text-sm file:font-medium file:text-foreground',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
