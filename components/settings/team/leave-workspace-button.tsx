'use client';

import { LogOut } from 'lucide-react';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { leaveWorkspaceAction } from '@/server/actions/member.actions';

/**
 * Leaving the business.
 *
 * Separate from "remove", and deliberately not in the roster row: being removed and
 * choosing to go are different acts with different consequences, and a self-remove
 * sitting in the same menu as everyone else's is one misclick from locking an owner
 * out of their own shop.
 *
 * `blockedReason` is the server's answer, not this component's guess. When the sole
 * owner tries to leave, the reason is shown up front instead of after a failed
 * attempt — but the action refuses it either way.
 */
export function LeaveWorkspaceButton({
  workspaceName,
  blockedReason,
}: {
  workspaceName: string;
  blockedReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(leaveWorkspaceAction, IDLE_FORM_STATE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave this business</CardTitle>
        <CardDescription>
          {blockedReason
            ? blockedReason
            : `You will lose access to ${workspaceName}. Your other businesses are not affected.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          disabled={blockedReason !== null}
          // The reason is already in the description above, so the button does not
          // need a tooltip repeating it — but the disabled state needs to be
          // explained to a screen reader that jumped straight to the control.
          aria-describedby={blockedReason ? 'leave-blocked-reason' : undefined}
        >
          <LogOut aria-hidden />
          Leave {workspaceName}
        </Button>
        {blockedReason ? (
          <span id="leave-blocked-reason" className="sr-only">
            {blockedReason}
          </span>
        ) : null}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave {workspaceName}?</DialogTitle>
            <DialogDescription>
              You will be signed out of this business straight away. Conversations and orders you
              handled stay in its records. Someone with access will have to invite you back.
            </DialogDescription>
          </DialogHeader>
          <form action={formAction} className="flex flex-col gap-4">
            <FormAlert state={state} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Stay
              </Button>
              <SubmitButton variant="destructive" pendingText="Leaving…">
                Leave business
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
