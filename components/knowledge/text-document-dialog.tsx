'use client';

/**
 * Writing, or rewriting, a piece of text the assistant answers from.
 *
 * Always rendered open, and mounted only while it is wanted. That is deliberate rather than
 * incidental: `useActionState` keeps its last result for the life of the component, so a
 * dialog kept mounted and toggled would reopen showing the outcome of the previous save. A
 * fresh mount per open is a fresh form, a fresh pending state and no stale alert.
 *
 * One component for adding and for editing, because it is one form. The only difference is a
 * hidden `documentId`, and the action decides from its presence which path — and which
 * permission — applies.
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
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { Textarea } from '@/components/ui/textarea';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { saveTextKnowledgeAction } from '@/server/actions/knowledge.actions';
import {
  KNOWLEDGE_FIELD_MAX,
  type KnowledgeDocumentSource,
} from '@/server/validation/knowledge';

/** The text half of the stored source, narrowed off the schema's own output type so this
 *  form cannot drift from what the action accepts. */
type TextSource = Extract<KnowledgeDocumentSource, { type: 'TEXT' }>;

/**
 * A worked example rather than a hint. A blank textarea under the words "what should your
 * assistant know?" is the point at which most people close the dialog, and the shape of the
 * answer — short lines, one fact each, real figures — is most of what decides whether the
 * assistant can answer from it later.
 */
const CONTENT_PLACEHOLDER = `We deliver all over Pakistan.
Lahore and Karachi: 2–3 days. Other cities: 3–5 days.
Delivery charges Rs. 250, free on orders over Rs. 3,000.
Cash on delivery is available everywhere we deliver.`;

export function TextDocumentDialog({
  existing,
  onClose,
}: {
  /** Absent when adding; the stored source when editing. */
  existing?: TextSource;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(saveTextKnowledgeAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  const editing = existing !== undefined;

  useCloseOnSuccess(state, onClose);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit this knowledge' : 'Add knowledge'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Your assistant reads this again from the start after you save, so it answers from the new version.'
              : 'Anything you would tell a new shop assistant on their first day — delivery, payment, sizes, what you do and do not sell.'}
          </DialogDescription>
        </DialogHeader>

        {/* No success state is rendered: a save closes this dialog and the row underneath
            changes to show what happened. Only a failure needs the space. */}
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {state.status === 'error' ? <FormAlert state={state} /> : null}

          {editing ? <input type="hidden" name="documentId" value={existing.documentId} /> : null}

          <FormField error={fieldErrors?.title?.[0]}>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input
                name="title"
                autoComplete="off"
                placeholder="e.g. Delivery charges and timings"
                required
                maxLength={KNOWLEDGE_FIELD_MAX.title}
                defaultValue={existing?.title}
              />
            </FormControl>
            <FormDescription>
              How you will find this later. Your customers never see the name.
            </FormDescription>
          </FormField>

          <FormField error={fieldErrors?.content?.[0]}>
            <FormLabel>What should your assistant know?</FormLabel>
            <FormControl>
              <Textarea
                name="content"
                rows={10}
                placeholder={CONTENT_PLACEHOLDER}
                required
                maxLength={KNOWLEDGE_FIELD_MAX.content}
                defaultValue={existing?.content}
                className="min-h-48"
              />
            </FormControl>
            <FormDescription>
              Plain sentences work best. Keep separate topics separate — delivery in one piece,
              exchanges in another — because each is answered on its own.
            </FormDescription>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingText="Saving…">
              {editing ? 'Save changes' : 'Save'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
