'use client';

/**
 * The way out of a document that did not finish processing.
 *
 * A form of its own rather than an item in the row's menu. Radix unmounts a dropdown's
 * content when the menu closes, and a form submitted from inside it is torn down mid-flight —
 * an intermittent failure, which is the worst kind. It also belongs in the cell beside the
 * reason it failed: what went wrong and what to do about it read as one thing.
 *
 * A failure here is shown inline instead of in a dialog. The button is already sitting under
 * an explanation, and opening a panel to say "that did not work either" would bury the retry
 * the person is about to press again.
 */

import { RotateCw } from 'lucide-react';
import { useActionState } from 'react';

import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { retryKnowledgeAction } from '@/server/actions/knowledge.actions';

export function RetryKnowledgeButton({
  documentId,
  title,
}: {
  documentId: string;
  /** Only for the accessible label: several rows carry this button, and "Try again" on its
   *  own tells a screen-reader user nothing about which one they are on. */
  title: string;
}) {
  const [state, formAction] = useActionState(retryKnowledgeAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="mt-2 flex flex-col items-start gap-1.5">
      <input type="hidden" name="documentId" value={documentId} />
      <SubmitButton
        variant="outline"
        size="sm"
        pendingText="Starting…"
        aria-label={`Try “${title}” again`}
      >
        <RotateCw aria-hidden />
        Try again
      </SubmitButton>

      {state.status === 'error' && state.message ? (
        <span role="status" className="text-xs text-destructive">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
