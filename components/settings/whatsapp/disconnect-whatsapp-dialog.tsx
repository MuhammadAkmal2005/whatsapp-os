'use client';

import { useActionState, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

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
        <Button variant="outline" className="text-destructive hover:bg-destructive/10">
          Disconnect
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            <DialogTitle>Disconnect WhatsApp Account</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-left">
            Are you sure you want to disconnect WhatsApp account <strong>{wabaId}</strong>
            {displayPhoneNumber ? ` (${displayPhoneNumber})` : ''}?
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Disconnecting will remove the encrypted access token from this workspace. Your AI agent and
          team will not be able to send or receive WhatsApp messages until reconnected.
        </p>

        {state.status === 'error' ? <FormAlert state={state} /> : null}

        <form action={formAction} className="mt-2">
          <input type="hidden" name="accountId" value={accountId} />
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <SubmitButton
              variant="destructive"
              pendingText="Disconnecting…"
            >
              Confirm Disconnect
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
