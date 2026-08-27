'use client';

/**
 * Takes a product off the catalogue.
 *
 * A soft delete, and the copy says so rather than hiding behind "Delete". Past orders keep
 * their own snapshot of the name, code and price they were sold at, so removing a product
 * corrupts nothing an old order depends on — but it does take the item off the lists and
 * stops the AI offering it. Saying that plainly means the shop owner is not surprised later
 * when the name still shows on an old order.
 *
 * Typing the name to confirm is deliberate friction: this is one of the few actions on the
 * page a mis-tap cannot undo from the UI.
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
import { deleteProductAction } from '@/server/actions/product.actions';

export function DeleteProductDialog({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, formAction] = useActionState(deleteProductAction, IDLE_FORM_STATE);

  const confirmed = typed.trim().toLowerCase() === productName.trim().toLowerCase();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Closing clears the typed confirmation, so a second visit does not start one
        // click away from a deletion.
        if (!next) setTyped('');
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="size-4" aria-hidden />
          Remove product
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {productName}?</DialogTitle>
          <DialogDescription>
            It will no longer appear in your catalogue and your AI will stop offering it to
            customers. Past orders that included it are kept exactly as they were, so your
            records and totals stay correct. You can add it again later.
          </DialogDescription>
        </DialogHeader>

        {/* On success the action redirects to the catalogue, so there is no success state
            to render here — only a failure needs showing. */}
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="productId" value={productId} />

          {state.status === 'error' ? <FormAlert state={state} /> : null}

          {/* No hand-written ids or aria-describedby: FormControl injects both through a
              Slot, and a prop passed here would win the merge and detach the hint. */}
          <FormField>
            <FormLabel>Type the product name to confirm</FormLabel>
            <FormControl>
              <Input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                placeholder={productName}
              />
            </FormControl>
            <FormDescription>This is here so a stray tap cannot remove a product.</FormDescription>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep product
            </Button>
            <SubmitButton variant="destructive" disabled={!confirmed} pendingText="Removing…">
              Remove product
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
