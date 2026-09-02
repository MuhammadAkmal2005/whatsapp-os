'use client';

/**
 * Start a conversation with a customer who is already in the workspace.
 *
 * Rebuilt on the form primitives rather than around them. The old version had a hand-rolled
 * `<textarea>` carrying its own border, its own focus ring on top of the global one, and a
 * dead `shadow-soft`; a filter field shrunk with `h-8 text-xs` overrides; and no label on
 * that field at all, so its only name was a placeholder that vanished as soon as you typed.
 *
 * Two honesty fixes in the copy. The customer picker holds the list it was given — up to
 * fifty — and the filter narrows *that list*, so it is labelled as filtering the list rather
 * than searching your customers. And the opening message now says what WhatsApp actually
 * permits, because a business-initiated free-form message outside the 24-hour window is
 * refused by Meta, and the first place a shop owner meets that rule should not be a failed
 * send.
 */

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { SubmitButton } from '@/components/ui/submit-button';
import { Textarea } from '@/components/ui/textarea';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { createConversationAction } from '@/server/actions/conversation.actions';

export function NewConversationDialog({
  open,
  onOpenChange,
  contacts,
  assignees,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: { id: string; name: string | null; phoneE164: string }[];
  assignees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(createConversationAction, IDLE_FORM_STATE);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (state.status === 'success') {
      onOpenChange(false);
      router.refresh();
    }
  }, [state.status, onOpenChange, router]);

  const term = filter.trim().toLowerCase();

  const matches = term
    ? contacts.filter(
        (contact) =>
          contact.name?.toLowerCase().includes(term) ||
          contact.phoneE164.toLowerCase().includes(term),
      )
    : contacts;

  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a conversation</DialogTitle>
          <DialogDescription>
            Open a thread with a customer who is already saved in your workspace.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <FormAlert state={state} />

          <FormField error={fieldErrors?.['contactId']?.[0]}>
            <FormLabel>Customer</FormLabel>

            <div className="flex flex-col gap-2">
              <Label htmlFor="customer-filter" className="sr-only">
                Filter the customer list
              </Label>
              <Input
                id="customer-filter"
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by name or number"
              />

              <FormControl>
                <NativeSelect name="contactId" required defaultValue="">
                  <option value="" disabled>
                    Choose a customer
                  </option>
                  {matches.length === 0 ? (
                    <option value="" disabled>
                      No customer in this list matches that
                    </option>
                  ) : null}
                  {matches.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name ? `${contact.name} — ${contact.phoneE164}` : contact.phoneE164}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
            </div>

            {term ? (
              <FormDescription className="text-xs">
                Showing {matches.length} of {contacts.length}.
              </FormDescription>
            ) : null}
          </FormField>

          <FormField error={fieldErrors?.['assignedToMemberId']?.[0]}>
            <FormLabel>Handled by</FormLabel>
            <FormControl>
              <NativeSelect name="assignedToMemberId" defaultValue="">
                <option value="">Nobody yet — anyone on the team can pick it up</option>
                {assignees.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          </FormField>

          <FormField error={fieldErrors?.['initialMessageBody']?.[0]}>
            <FormLabel>Opening message</FormLabel>
            <FormControl>
              <Textarea
                name="initialMessageBody"
                rows={3}
                placeholder="Assalamualaikum! How can we help you today?"
              />
            </FormControl>
            <FormDescription className="text-xs">
              Optional. WhatsApp only allows a free-form message within 24 hours of the
              customer&apos;s last message — after that you need an approved template.
            </FormDescription>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton pendingText="Starting…">Start conversation</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
