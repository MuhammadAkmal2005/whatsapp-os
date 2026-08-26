'use client';

import { useActionState } from 'react';
import { Check } from 'lucide-react';

import { FormAlert } from '@/components/ui/form-alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { acceptInviteAction } from '@/server/actions/member.actions';

/**
 * Accepts an invitation.
 *
 * The token travels in a hidden field rather than being closed over, so the value
 * that reaches the action is the one in the URL the person actually opened. The
 * action verifies the token, that it is still valid, and that the signed-in
 * account's email matches the invited address — this button proves nothing on its
 * own.
 */
export function AcceptInviteForm({
  token,
  workspaceName,
}: {
  token: string;
  workspaceName: string;
}) {
  const [state, formAction] = useActionState(acceptInviteAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormAlert state={state} />
      <input type="hidden" name="token" value={token} />
      <SubmitButton className="w-full" pendingText="Joining…">
        <Check className="size-4" aria-hidden />
        Join {workspaceName}
      </SubmitButton>
    </form>
  );
}
