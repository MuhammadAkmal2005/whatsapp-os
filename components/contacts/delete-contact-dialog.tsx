'use client';

/**
 * Removes a customer from the lists.
 *
 * It is a soft delete, and the copy says so plainly rather than hiding it behind
 * "Delete". Orders, payments and conversations keep pointing at this record — an
 * order with no customer is an accounting hole — so what actually happens is that
 * they stop appearing in the customer list and the AI stops treating them as a live
 * contact. Telling the truth here also means the person is not surprised later when
 * the name still shows on an old order.
 *
 * Typing the name to confirm is deliberate friction. This is one of the few actions
 * on the profile that a mis-tap cannot undo from the UI.
 */

import { Trash2 } from 'lucide-react';
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
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { deleteContactAction } from '@/server/actions/contact.actions';

export function DeleteContactDialog({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, formAction] = useActionState(deleteContactAction, IDLE_FORM_STATE);

  const confirmed = typed.trim().toLowerCase() === contactName.trim().toLowerCase();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Closing clears the typed confirmation. Leaving it filled would mean a second
        // visit to this dialog starts one click from a deletion.
        if (!next) setTyped('');
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="size-4" aria-hidden />
          Remove customer
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {contactName}?</DialogTitle>
          <DialogDescription>
            They will no longer appear in your customer list and your AI will stop treating them
            as a live contact. Their past orders and conversations are kept, so your records and
            totals stay correct.
          </DialogDescription>
        </DialogHeader>

        {/* On success the action redirects to the list, so there is no success state to
            render here — only a failure needs showing. */}
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="contactId" value={contactId} />

          {state.status === 'error' ? <FormAlert state={state} /> : null}

          {/* No hand-written ids or aria-describedby: FormControl injects both onto
              the control through a Slot, and a prop passed here would win the merge
              and quietly detach the hint from the input. */}
          <FormField>
            <FormLabel>Type their name to confirm</FormLabel>
            <FormControl>
              <Input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                placeholder={contactName}
              />
            </FormControl>
            <FormDescription>
              This is here so a stray tap cannot remove a customer.
            </FormDescription>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep customer
            </Button>
            <SubmitButton variant="destructive" disabled={!confirmed} pendingText="Removing…">
              Remove customer
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
