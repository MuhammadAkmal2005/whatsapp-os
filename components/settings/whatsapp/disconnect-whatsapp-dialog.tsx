'use client';

/**
 * Stops a number carrying messages.
 *
 * Reversible, but not cheaply: disconnecting deletes the encrypted access token, so coming back
 * means fetching a fresh one from Meta. That is the fact worth saying out loud, so it is in the
 * dialog rather than discovered afterwards — and it is why this asks for one deliberate
 * confirmation instead of typed friction.
 *
 * Conversations, contacts and orders already recorded are untouched. Only the connection goes.
 */

import { AlertTriangle } from 'lucide-react';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { disconnectWhatsAppAction } from '@/server/actions/whatsapp-account.actions';

type DisconnectWhatsAppDialogProps = {
  accountId: string;
  wabaId: string;
  displayPhoneNumber?: string;
};

export function DisconnectWhatsAppDialog({
  accountId,
  wabaId,
  displayPhoneNumber,
}: DisconnectWhatsAppDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(disconnectWhatsAppAction, IDLE_FORM_STATE);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          <AlertTriangle aria-hidden />
          Disconnect
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect {displayPhoneNumber ?? 'this number'}?</DialogTitle>
          <DialogDescription>
            Customer messages will stop arriving in your inbox and your AI will stop replying.
            Everything already recorded — conversations, customers and orders — is kept.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Your saved access token is deleted, so reconnecting later means getting a new one from
          Meta for account <span className="font-mono">{wabaId}</span>.
        </p>

        {/* Only a failure needs showing: on success the page revalidates and this card is
            replaced by the connect form. */}
        <form action={formAction}>
          <input type="hidden" name="accountId" value={accountId} />

          {state.status === 'error' ? <FormAlert state={state} /> : null}

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Stay connected
            </Button>
            <SubmitButton variant="destructive" pendingText="Disconnecting…">
              Disconnect number
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
