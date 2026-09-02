'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * An on/off control for a setting that takes effect immediately.
 *
 * Sized 24px tall rather than the usual 20px so the whole control clears the 24×24
 * minimum target size — this switch turns the AI agent on and off on a phone, and a
 * mis-tap there has real consequences.
 *
 * The thumb carries a tight shadow. That is not decoration: it is the one place in this
 * product where an element genuinely sits on top of another element at close range, and
 * without it the thumb and a light track merge.
 */
const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
      'transition-colors duration-fast ease-out',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block size-5 rounded-full bg-card shadow-[0_1px_2px_hsl(172_24%_10%/0.2)] ring-0',
        'transition-transform duration-fast ease-out',
        'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
