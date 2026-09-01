'use client';

/**
 * Modal to initiate a new conversation with a customer.
 *
 * Allows selecting a customer from the workspace directory, choosing an initial assignee,
 * and appending an optional opening message.
 */

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';

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
import { FormControl, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { createConversationAction } from '@/server/actions/conversation.actions';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-soft transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:border-primary/30';

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

  // Close dialog on success and refresh router
  useEffect(() => {
    if (state.status === 'success') {
      onOpenChange(false);
      router.refresh();
    }
  }, [state.status, onOpenChange, router]);

  const filteredContacts = contacts.filter((c) => {
    if (!filter) return true;
    const term = filter.toLowerCase();
    return (
      (c.name && c.name.toLowerCase().includes(term)) ||
      c.phoneE164.toLowerCase().includes(term)
    );
  });

  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <MessageSquarePlus className="size-4" aria-hidden />
            </div>
            <div>
              <DialogTitle>Start conversation</DialogTitle>
              <DialogDescription>
                Open a new chat with an existing customer.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <FormAlert state={state} />

          {/* Contact Selector */}
          <FormField error={fieldErrors?.['contactId']?.[0]}>
            <FormLabel htmlFor="contactId">Customer</FormLabel>
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Filter by name or phone..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-8 text-xs mb-1"
              />
              <FormControl>
                <select id="contactId" name="contactId" required className={SELECT_CLASS} defaultValue="">
                  <option value="" disabled>
                    Select a customer...
                  </option>
                  {filteredContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name ? `${contact.name} (${contact.phoneE164})` : contact.phoneE164}
                    </option>
                  ))}
                </select>
              </FormControl>
            </div>
          </FormField>

          {/* Initial Assignee */}
          <FormField error={fieldErrors?.['assignedToMemberId']?.[0]}>
            <FormLabel htmlFor="assignedToMemberId">Assign to</FormLabel>
            <FormControl>
              <select id="assignedToMemberId" name="assignedToMemberId" className={SELECT_CLASS} defaultValue="">
                <option value="">Unassigned (shared pool)</option>
                {assignees.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </FormControl>
          </FormField>

          {/* Opening Message */}
          <div className="space-y-1.5">
            <FormLabel htmlFor="initialMessageBody">Opening message (optional)</FormLabel>
            <textarea
              id="initialMessageBody"
              name="initialMessageBody"
              rows={3}
              placeholder="Hi, how can we help you today?"
              className="w-full rounded-md border border-input bg-background p-3 text-sm shadow-soft transition-all duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-primary/30"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <SubmitButton>Start chat</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
