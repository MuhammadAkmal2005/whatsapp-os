'use client';

import { useActionState, useId } from 'react';

import { FormField, FormLabel, FormControl, FormDescription } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { BUSINESS_CATEGORIES } from '@/config/constants';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { createWorkspaceAction } from '@/server/actions/workspace.actions';

/**
 * Creates the first (or another) workspace. Submits through
 * `createWorkspaceAction`, which validates with the shared schema, provisions
 * the workspace + owner membership + trial in one transaction, sets the active
 * cookie, and redirects to the dashboard.
 *
 * Category is a free-text input backed by a datalist of common categories: the
 * list is a convenience, not a closed set, so a business that does not fit any
 * label is never turned away — matching the validation, which accepts any text.
 */
export function CreateWorkspaceForm() {
  const [state, formAction] = useActionState(createWorkspaceAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  const categoryListId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />

      <FormField error={fieldErrors?.name?.[0]}>
        <FormLabel>Business name</FormLabel>
        <FormControl>
          <Input
            name="name"
            autoComplete="organization"
            placeholder="e.g. Akmal Fashion"
            required
            autoFocus
            maxLength={80}
          />
        </FormControl>
        <FormDescription>This is how your workspace appears across the dashboard.</FormDescription>
      </FormField>

      <FormField error={fieldErrors?.category?.[0]}>
        <FormLabel>What do you sell?</FormLabel>
        <FormControl>
          <Input
            name="category"
            list={categoryListId}
            placeholder="e.g. Clothing & Fashion"
            maxLength={60}
          />
        </FormControl>
        <datalist id={categoryListId}>
          {BUSINESS_CATEGORIES.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <FormDescription>
          Optional — pick one or type your own. You can change this later.
        </FormDescription>
      </FormField>

      <SubmitButton className="mt-2 w-full" pendingText="Creating your business…">
        Create business
      </SubmitButton>
    </form>
  );
}
