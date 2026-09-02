'use client';

/**
 * A submit button that reflects the enclosing form's pending state.
 *
 * `useFormStatus` reads the status of the nearest parent `<form>`, so this must live in
 * its own client component *inside* the form — it cannot read a sibling form. While the
 * server action runs it disables itself and shows a spinner, which is what stops a
 * double-submit without any per-form wiring.
 *
 * The spinner and the aria-busy flag come from Button's own loading state rather than
 * being assembled here, so a pending submit looks identical to every other pending
 * button in the product.
 */

import { useFormStatus } from 'react-dom';

import { Button, type ButtonProps } from '@/components/ui/button';

type SubmitButtonProps = ButtonProps & {
  /**
   * Replaces the label while the action runs — use it when the verb should change
   * tense, as in "Save changes" becoming "Saving…". Omit it to keep the label still,
   * which is usually better because the button does not change width.
   */
  pendingText?: string;
};

export function SubmitButton({ children, pendingText, disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" isLoading={pending} disabled={disabled} {...props}>
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
