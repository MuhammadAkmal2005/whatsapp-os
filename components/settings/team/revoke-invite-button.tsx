'use client';

import { X } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { revokeInviteAction } from '@/server/actions/member.actions';

/**
 * Cancels a pending invitation.
 *
 * Confirmed rather than immediate: the link is single-use and unrecoverable, so
 * cancelling by mistake means issuing a new one and chasing the person again.
 *
 * Rendered only where the caller holds `member:invite`, and the action re-checks
 * that permission and the workspace scope regardless.
 */
export function RevokeInviteButton({ inviteId, email }: { inviteId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(revokeInviteAction, IDLE_FORM_STATE);

  // The row disappears on revalidation, which unmounts this anyway — closing here
  // just avoids a frame of dialog left over the list.
  useEffect(() => {
    if (state.status === 'success') setOpen(false);
  }, [state.status]);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Cancel the invitation for ${email}`}
      >
        <X aria-hidden />
        Cancel
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this invitation?</DialogTitle>
            <DialogDescription>
              The link sent to {email} will stop working. If they still need access, invite them
              again to get a fresh link.
            </DialogDescription>
          </DialogHeader>
          <form action={formAction} className="flex flex-col gap-4">
            <FormAlert state={state} />
            <input type="hidden" name="inviteId" value={inviteId} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep it
              </Button>
              <SubmitButton variant="destructive" pendingText="Cancelling…">
                Cancel invitation
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
