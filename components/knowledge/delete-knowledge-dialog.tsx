'use client';

/**
 * Confirming the removal of a piece of knowledge.
 *
 * A plain confirmation rather than a typed one. The heavier pattern — retype the name to
 * proceed — is reserved in this product for actions that cannot be undone *and* affect other
 * people's access or records. This one destroys only what the owner wrote themselves, and the
 * copy says plainly that it cannot be recovered.
 *
 * What the confirmation is really for is the sentence about the assistant. Deleting knowledge
 * silently changes how every future customer is answered, and that consequence is invisible
 * from a table row.
 */

import { useActionState } from 'react';

import { useCloseOnSuccess } from '@/components/knowledge/use-close-on-success';
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
import { deleteKnowledgeAction } from '@/server/actions/knowledge.actions';

export function DeleteKnowledgeDialog({
  documentId,
  title,
  onClose,
}: {
  documentId: string;
  title: string;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(deleteKnowledgeAction, IDLE_FORM_STATE);

  useCloseOnSuccess(state, onClose);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove “{title}”?</DialogTitle>
          <DialogDescription>
            Your assistant stops using it straight away and will say it does not know rather than
            guess. What you wrote is deleted for good — bringing it back means typing it again.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <FormAlert state={state} />
          <input type="hidden" name="documentId" value={documentId} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Keep it
            </Button>
            <SubmitButton variant="destructive" pendingText="Removing…">
              Remove
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
