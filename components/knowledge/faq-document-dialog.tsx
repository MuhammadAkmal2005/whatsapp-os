'use client';

/**
 * A question a customer asks, and the answer the assistant should give.
 *
 * The twin of `TextDocumentDialog`, and separate from it rather than a mode of it. The two
 * post different fields to different schemas, and a single form that swapped its fields on a
 * toggle would have to decide what happens to what was typed in the other shape — a question
 * nobody wants asked of them mid-sentence.
 *
 * Q&A exists alongside plain text because a question is not decoration: the words a customer
 * uses are what the assistant matches against, and "kya exchange ho sakta hai?" finds the
 * exchange policy far more reliably than a paragraph that never phrases itself as a question.
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
import { saveFaqKnowledgeAction } from '@/server/actions/knowledge.actions';
import { KNOWLEDGE_FIELD_MAX, type KnowledgeDocumentSource } from '@/server/validation/knowledge';

/** The Q&A half of the stored source, narrowed off the schema's own output type. */
type FaqSource = Extract<KnowledgeDocumentSource, { type: 'FAQ' }>;

const ANSWER_PLACEHOLDER = `Yes, exchange is possible within 7 days.
The item must be unused with its tags still on.
Delivery charges for the exchange are paid by the customer.`;

export function FaqDocumentDialog({
  existing,
  onClose,
}: {
  /** Absent when adding; the stored source when editing. */
  existing?: FaqSource;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(saveFaqKnowledgeAction, IDLE_FORM_STATE);
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
          <DialogTitle>{editing ? 'Edit this Q&A' : 'Add a Q&A'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Your assistant reads this again from the start after you save, so it answers from the new version.'
              : 'For the questions you answer over and over. Write the question the way customers actually ask it.'}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {state.status === 'error' ? <FormAlert state={state} /> : null}

          {editing ? <input type="hidden" name="documentId" value={existing.documentId} /> : null}

          <FormField error={fieldErrors?.title?.[0]}>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input
                name="title"
                autoComplete="off"
                placeholder="e.g. Exchange policy"
                required
                maxLength={KNOWLEDGE_FIELD_MAX.title}
                defaultValue={existing?.title}
              />
            </FormControl>
            <FormDescription>
              How you will find this later. Your customers never see the name.
            </FormDescription>
          </FormField>

          <FormField error={fieldErrors?.question?.[0]}>
            <FormLabel>What do customers ask?</FormLabel>
            <FormControl>
              <Input
                name="question"
                autoComplete="off"
                placeholder="e.g. Kya exchange ho sakta hai?"
                required
                maxLength={KNOWLEDGE_FIELD_MAX.question}
                defaultValue={existing?.question}
              />
            </FormControl>
            <FormDescription>
              Their words, not yours — Urdu, Roman Urdu or English, however they type it.
            </FormDescription>
          </FormField>

          <FormField error={fieldErrors?.answer?.[0]}>
            <FormLabel>What should your assistant answer?</FormLabel>
            <FormControl>
              <Textarea
                name="answer"
                rows={6}
                placeholder={ANSWER_PLACEHOLDER}
                required
                maxLength={KNOWLEDGE_FIELD_MAX.answer}
                defaultValue={existing?.answer}
                className="min-h-32"
              />
            </FormControl>
            <FormDescription>
              Say it as you would on a call. Your assistant puts it in its own words, but it will
              not go beyond what is written here.
            </FormDescription>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingText="Saving…">{editing ? 'Save changes' : 'Save'}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
