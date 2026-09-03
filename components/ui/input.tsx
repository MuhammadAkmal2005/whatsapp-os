import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared field chrome for text inputs, textareas and native selects, so the three
 * cannot drift apart. Anything that looks like a field in this product uses this string.
 *
 * Three details worth knowing.
 *
 * `min-w-0` is load-bearing, not tidiness. A bare `<input>` carries a UA intrinsic width of
 * roughly 180px, and that width becomes the automatic minimum size of whatever flex or grid
 * track holds it — so a field beside a button in a `flex` row pushes the row past the
 * viewport on a 320px phone and takes the whole document's horizontal scrollbar with it. One
 * declaration here fixes every field in the product rather than each call site remembering.
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
  'flex w-full min-w-0 rounded-md border border-input bg-card text-md text-foreground sm:text-sm',
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
