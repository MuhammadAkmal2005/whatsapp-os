'use client';

import { useActionState } from 'react';

import { FormField, FormLabel, FormControl, FormDescription } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { PASSWORD_MIN_LENGTH } from '@/config/constants';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { signupAction } from '@/server/actions/auth.actions';

/**
 * Account creation. The password hint states the real rule — length, no
 * composition theatre — because the service enforces exactly that and nothing
 * frustrates like a rule you cannot see. Field values survive a failed submit
 * for the same reason as the login form: the inputs are uncontrolled and React
 * keeps their DOM state across the action's re-render.
 *
 * `inviteToken` is present when they came from an invitation. Without it a new
 * account goes to onboarding to create a business, which is the wrong question to
 * ask someone who was invited to join one.
 */
export function SignupForm({ inviteToken }: { inviteToken?: string }) {
  const [state, formAction] = useActionState(signupAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      {inviteToken ? <input type="hidden" name="invite" value={inviteToken} /> : null}

      <FormField error={fieldErrors?.name?.[0]}>
        <FormLabel>Your name</FormLabel>
        <FormControl>
          <Input name="name" autoComplete="name" placeholder="Ahmed Khan" required autoFocus />
        </FormControl>
      </FormField>

      <FormField error={fieldErrors?.email?.[0]}>
        <FormLabel>Email</FormLabel>
        <FormControl>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@business.pk"
            required
          />
        </FormControl>
      </FormField>

      <FormField error={fieldErrors?.password?.[0]}>
        <FormLabel>Password</FormLabel>
        <FormControl>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </FormControl>
        <FormDescription>At least {PASSWORD_MIN_LENGTH} characters. Longer is stronger.</FormDescription>
      </FormField>

      <SubmitButton className="mt-2 w-full" pendingText="Creating your account…">
        Create account
      </SubmitButton>
    </form>
  );
}
