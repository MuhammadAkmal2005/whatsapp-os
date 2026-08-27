'use client';

/**
 * The rest of a customer's details.
 *
 * Deliberately not a modal. Filling in an address is the one thing on this page that
 * takes more than a moment, and a dialog on a phone puts the keyboard over half the
 * fields. It also stays out of the way when it is not being used: the fields are
 * disabled until "Edit" is pressed, so the profile reads as a record rather than as a
 * form that might already have unsaved changes in it.
 *
 * The status, stage and assignment pickers are above this and save on their own. This
 * form must not include them — see the note on `updateContactSchema` for why a save
 * here would otherwise clear the assignment.
 */

import { useActionState, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { updateContactAction } from '@/server/actions/contact.actions';
import type { Contact } from '@/server/services/contact/contact.service';
import { CONTACT_FIELD_MAX } from '@/server/validation/contact';

export function EditContactForm({
  contact,
  canUpdate,
}: {
  contact: Contact;
  canUpdate: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(updateContactAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  // Leaving edit mode on success closes the loop: the fields go back to reading as a
  // record. On failure it stays open, because the values that failed are still in the
  // inputs and closing would throw away work.
  useEffect(() => {
    if (state.status === 'success') setEditing(false);
  }, [state]);

  const disabled = !editing;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="contactId" value={contact.id} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Details</h2>
        {canUpdate && !editing ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>

      {state.status === 'error' ? <FormAlert state={state} /> : null}
      {state.status === 'success' ? (
        <p className="text-xs text-muted-foreground" role="status">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.name?.[0]}>
          <FormLabel>Name</FormLabel>
          <FormControl>
            <Input
              name="name"
              defaultValue={contact.name ?? ''}
              disabled={disabled}
              maxLength={CONTACT_FIELD_MAX.name}
              autoComplete="off"
              placeholder={contact.waProfileName ?? 'Not set'}
            />
          </FormControl>
          {contact.waProfileName && !contact.name ? (
            <FormDescription>
              Their WhatsApp profile says “{contact.waProfileName}”. Saving a name here
              overrides it.
            </FormDescription>
          ) : null}
        </FormField>

        <FormField error={fieldErrors?.email?.[0]}>
          <FormLabel>Email</FormLabel>
          <FormControl>
            <Input
              name="email"
              type="email"
              defaultValue={contact.email ?? ''}
              disabled={disabled}
              maxLength={CONTACT_FIELD_MAX.email}
              autoComplete="off"
              placeholder="Not set"
            />
          </FormControl>
        </FormField>

        <FormField error={fieldErrors?.city?.[0]}>
          <FormLabel>City</FormLabel>
          <FormControl>
            <Input
              name="city"
              defaultValue={contact.city ?? ''}
              disabled={disabled}
              maxLength={CONTACT_FIELD_MAX.city}
              autoComplete="off"
              placeholder="e.g. Karachi"
            />
          </FormControl>
        </FormField>

        <FormField error={fieldErrors?.postalCode?.[0]}>
          <FormLabel>Postal code</FormLabel>
          <FormControl>
            <Input
              name="postalCode"
              defaultValue={contact.postalCode ?? ''}
              disabled={disabled}
              maxLength={CONTACT_FIELD_MAX.postalCode}
              autoComplete="off"
              placeholder="Optional"
            />
          </FormControl>
        </FormField>
      </div>

      <FormField error={fieldErrors?.addressLine1?.[0]}>
        <FormLabel>Delivery address</FormLabel>
        <FormControl>
          <Input
            name="addressLine1"
            defaultValue={contact.addressLine1 ?? ''}
            disabled={disabled}
            maxLength={CONTACT_FIELD_MAX.address}
            autoComplete="off"
            placeholder="House and street"
          />
        </FormControl>
      </FormField>

      <FormField error={fieldErrors?.addressLine2?.[0]}>
        <FormControl>
          <Input
            name="addressLine2"
            defaultValue={contact.addressLine2 ?? ''}
            disabled={disabled}
            maxLength={CONTACT_FIELD_MAX.address}
            autoComplete="off"
            placeholder="Area or landmark"
            aria-label="Delivery address, second line"
          />
        </FormControl>
        <FormDescription>
          Used to fill in orders, so the customer does not have to type it again.
        </FormDescription>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.source?.[0]}>
          <FormLabel>How they found you</FormLabel>
          <FormControl>
            <Input
              name="source"
              defaultValue={contact.source ?? ''}
              disabled={disabled}
              maxLength={CONTACT_FIELD_MAX.source}
              autoComplete="off"
              placeholder="e.g. Instagram"
            />
          </FormControl>
        </FormField>

        <FormField error={fieldErrors?.language?.[0]}>
          <FormLabel>Language</FormLabel>
          <FormControl>
            <Input
              name="language"
              defaultValue={contact.language ?? ''}
              disabled={disabled}
              maxLength={CONTACT_FIELD_MAX.language}
              autoComplete="off"
              placeholder="e.g. Roman Urdu"
            />
          </FormControl>
          <FormDescription>What your AI should reply in for this customer.</FormDescription>
        </FormField>
      </div>

      {editing ? (
        <div className="flex items-center justify-end gap-3">
          {/* A real `type="reset"`, which restores every field to the `defaultValue`
              the server rendered. Clearing the inputs instead would be the more common
              reading of "reset" and the wrong one here: the person wants their edits
              discarded, not the customer's details emptied. */}
          <Button type="reset" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <SubmitButton pendingText="Saving…">Save details</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
