'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { FormField, FormLabel, FormControl } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { loginAction } from '@/server/actions/auth.actions';

/**
 * Sign-in form. Submits through the `loginAction` server action via
 * `useActionState`, so the same Zod schema validates on the client's behalf and
 * on the server as the authority. Inputs are uncontrolled: on a validation error
 * the action returns field messages and React preserves the typed values across
 * the re-render, so the person does not lose what they entered.
 *
 * `inviteToken` is present when they arrived from an invitation link. It rides
 * along so the action can send them back to it instead of to their own dashboard;
 * the action revalidates it and ignores anything malformed.
 */
export function LoginForm({ inviteToken }: { inviteToken?: string }) {
  const [state, formAction] = useActionState(loginAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      {inviteToken ? <input type="hidden" name="invite" value={inviteToken} /> : null}

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
            autoFocus
          />
        </FormControl>
      </FormField>

      <FormField error={fieldErrors?.password?.[0]}>
        <div className="flex items-center justify-between">
          <FormLabel>Password</FormLabel>
          <Link
            href="/forgot-password"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <FormControl>
          <Input name="password" type="password" autoComplete="current-password" required />
        </FormControl>
      </FormField>

      <SubmitButton className="mt-2 w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
