'use client';

/**
 * Internal notes on a customer.
 *
 * The thing that makes a note useful is that it is written in the ten seconds after
 * the call, so the box is always open — no "Add note" button to press first — and it
 * clears itself on success so the next one costs nothing either.
 *
 * Notes are internal. The customer never sees them, and the heading says so, because
 * the cost of that being unclear is someone writing "awkward, quote high" into what
 * they thought was a private field and what they feared was a message.
 */

import { useActionState, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FormControl, FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/datetime';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { addContactNoteAction } from '@/server/actions/contact.actions';
import type { ContactNote } from '@/server/services/contact/contact.service';
import { CONTACT_FIELD_MAX } from '@/server/validation/contact';

export function ContactNotes({
  contactId,
  notes,
  canAddNote,
}: {
  contactId: string;
  notes: ContactNote[];
  canAddNote: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {canAddNote ? <AddNoteForm contactId={contactId} /> : null}

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {canAddNote
            ? 'No notes yet. Anything you write here stays inside your team.'
            : 'No notes yet.'}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border border-border bg-muted/30 p-3">
              {/* Pre-wrap, so the line breaks someone typed are the line breaks they
                  get. A note is often a short list and collapsing it costs meaning. */}
              <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {note.authorName} · {formatDateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AddNoteForm({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState(addContactNoteAction, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  // Clearing on success rather than on submit. If the save fails the words are still
  // there to retry with, which matters most for the long note nobody wants to retype.
  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset();
  }, [state]);

  return (
    <form action={formAction} ref={formRef} className="flex flex-col gap-2">
      <input type="hidden" name="contactId" value={contactId} />

      {state.status === 'error' ? <FormAlert state={state} /> : null}

      <FormField error={state.status === 'error' ? state.fieldErrors?.body?.[0] : undefined}>
        <FormControl>
          <Textarea
            name="body"
            rows={3}
            maxLength={CONTACT_FIELD_MAX.note}
            placeholder="e.g. Wants the navy kurta in L — will confirm after payday."
            aria-label="Add an internal note"
          />
        </FormControl>
      </FormField>

      <div className="flex items-center justify-end gap-3">
        {state.status === 'success' ? (
          <span className="text-xs text-muted-foreground" role="status">
            {state.message}
          </span>
        ) : null}
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? 'Saving…' : 'Add note'}
        </Button>
      </div>
    </form>
  );
}
