'use client';

/**
 * Adds a customer by hand.
 *
 * Most customers arrive on their own — they message the business and the inbound
 * handler creates the record. This form is for the ones who do not: a walk-in, a
 * phone order, a list the owner is bringing across from their notebook. So the only
 * required field is the number, because that is the identity, and everything else
 * can be filled in later from the profile.
 *
 * The number cannot be edited afterwards, which is why it is only on this form.
 * Changing it would silently re-point every conversation and order on the record at
 * a different person; that is a merge, and a merge needs its own confirmation.
 */

import { UserPlus } from 'lucide-react';
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
import { createContactAction } from '@/server/actions/contact.actions';
import {
  CONTACT_FIELD_MAX,
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
} from '@/server/validation/contact';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-soft transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:border-primary/30';

export function CreateContactDialog({ assignees }: { assignees: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createContactAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" aria-hidden />
          Add customer
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a customer</DialogTitle>
          <DialogDescription>
            Only the WhatsApp number is needed. You can add the rest from their profile whenever
            you have it.
          </DialogDescription>
        </DialogHeader>

        {/* On success the action redirects to the new profile, so this form never
            renders a success state — only a failure needs showing. */}
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {state.status === 'error' ? <FormAlert state={state} /> : null}

          <FormField error={fieldErrors?.phone?.[0]}>
            <FormLabel>WhatsApp number</FormLabel>
            <FormControl>
              <Input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="0300 1234567"
                required
                maxLength={CONTACT_FIELD_MAX.phone}
              />
            </FormControl>
            <FormDescription>
              A local number is fine. Add the country code for customers outside your country.
            </FormDescription>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField error={fieldErrors?.name?.[0]}>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input name="name" autoComplete="off" placeholder="e.g. Ayesha Khan" maxLength={CONTACT_FIELD_MAX.name} />
              </FormControl>
            </FormField>

            <FormField error={fieldErrors?.city?.[0]}>
              <FormLabel>City</FormLabel>
              <FormControl>
                <Input name="city" autoComplete="off" placeholder="e.g. Lahore" maxLength={CONTACT_FIELD_MAX.city} />
              </FormControl>
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField error={fieldErrors?.status?.[0]}>
              <FormLabel>Status</FormLabel>
              <FormControl>
                <select name="status" defaultValue="LEAD" className={SELECT_CLASS}>
                  {CONTACT_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {CONTACT_STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              </FormControl>
            </FormField>

            <FormField error={fieldErrors?.assignedToMemberId?.[0]}>
              <FormLabel>Looked after by</FormLabel>
              <FormControl>
                <select name="assignedToMemberId" defaultValue="" className={SELECT_CLASS}>
                  <option value="">Nobody yet</option>
                  {assignees.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.name}
                    </option>
                  ))}
                </select>
              </FormControl>
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingText="Saving…">Save customer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
