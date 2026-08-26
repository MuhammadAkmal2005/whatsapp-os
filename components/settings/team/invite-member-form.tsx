'use client';

import { useActionState, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { inviteMemberAction, type InviteFormState } from '@/server/actions/member.actions';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type WorkspaceRole } from '@/server/authz/permissions';

const IDLE: InviteFormState = IDLE_FORM_STATE;

/**
 * Invites someone to the workspace.
 *
 * There is no email provider connected yet, so this does not claim to have sent
 * anything. It produces a single-use link and shows it once for the owner to pass
 * on — over WhatsApp, most likely, which is where their team already talks. When
 * email delivery lands it becomes an additional channel for the same token rather
 * than a replacement for this.
 *
 * `assignableRoles` comes from the server, which knows the caller's own role: an
 * ADMIN cannot invite another ADMIN, so that option is not offered. The service
 * refuses it regardless — this only keeps the form from presenting a choice that
 * would fail.
 */
export function InviteMemberForm({ assignableRoles }: { assignableRoles: WorkspaceRole[] }) {
  const [state, formAction] = useActionState(inviteMemberAction, IDLE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  const defaultRole = assignableRoles.includes('AGENT') ? 'AGENT' : assignableRoles[0];

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        {/* Only the failure is shown here; success is the link panel below. */}
        {state.status === 'error' ? <FormAlert state={state} /> : null}

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <FormField error={fieldErrors?.email?.[0]}>
            <FormLabel>Email address</FormLabel>
            <FormControl>
              <Input
                name="email"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="e.g. saad@akmalfashion.pk"
                required
                maxLength={254}
              />
            </FormControl>
            <FormDescription>
              They sign in with this address, so it has to be one they can open.
            </FormDescription>
          </FormField>

          <FormField error={fieldErrors?.role?.[0]}>
            <FormLabel>Role</FormLabel>
            <FormControl>
              {/* A native select: it is keyboard- and screen-reader-correct without
                  work, and on a phone it opens the platform picker, which is a
                  better experience than any custom listbox. */}
              <select
                name="role"
                defaultValue={defaultRole}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-44"
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </FormControl>
            <FormDescription className="sm:max-w-44">
              {defaultRole ? ROLE_DESCRIPTIONS[defaultRole] : null}
            </FormDescription>
          </FormField>
        </div>

        <SubmitButton className="sm:self-start" pendingText="Creating invitation…">
          Create invitation
        </SubmitButton>
      </form>

      {state.status === 'success' && state.invite ? (
        <InviteLinkPanel email={state.invite.email} url={state.invite.url} />
      ) : null}
    </div>
  );
}

function InviteLinkPanel({ email, url }: { email: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused — over plain HTTP, or by policy. The input
      // below is selectable, so the link is still obtainable; silently failing here
      // is better than an error the person cannot act on.
    }
  }

  return (
    <Alert variant="success">
      <Link2 className="size-4" aria-hidden />
      <AlertTitle>Invitation ready for {email}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          Send them this link. It works once, expires in 7 days, and is shown here only now — we
          store it hashed, so it cannot be looked up again.
        </p>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="invite-link">
            Invitation link
          </label>
          <Input
            id="invite-link"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={copy} className="shrink-0">
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            <span className="sr-only sm:not-sr-only">{copied ? 'Copied' : 'Copy'}</span>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
