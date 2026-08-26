'use client';

/**
 * A submit button that reflects the enclosing form's pending state.
 *
 * `useFormStatus` reads the status of the nearest parent `<form>`, so this must
 * live in its own client component *inside* the form — it cannot read a sibling
 * form. While the server action runs it disables itself and swaps in a spinner,
 * which is what stops a double-submit without any per-form wiring.
 */

import { useFormStatus } from 'react-dom';

import { Button, type ButtonProps } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type SubmitButtonProps = ButtonProps & {
  /** Shown next to the spinner while the action runs. Defaults to the label. */
  pendingText?: string;
};

export function SubmitButton({
  children,
  pendingText,
  disabled,
  className,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      className={cn(className)}
      {...props}
    >
      {pending ? (
        <>
          <Spinner className="size-4" />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
