import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, Building2, LogIn, UserPlus } from 'lucide-react';

import { AcceptInviteForm } from '@/components/settings/team/accept-invite-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { logoutAction } from '@/server/actions/auth.actions';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/server/authz/permissions';
import { toSafeError } from '@/server/errors';
import { previewInvite, type InvitePreview } from '@/server/services/member/member.service';
import { getUserContext } from '@/server/tenancy/resolve';

export const metadata: Metadata = {
  title: 'Your invitation',
};

/**
 * The invitation landing page.
 *
 * Public, because an invited person may not have an account yet — the unguessable
 * token is the credential for *viewing* this. It reveals only the business name,
 * the invited address and the role, which is what someone needs to decide whether
 * to accept and no more.
 *
 * Accepting is a different matter and requires a signed-in account whose email
 * matches the invitation, so a forwarded link does not let a bystander join.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let invite: InvitePreview;
  try {
    invite = await previewInvite(token);
  } catch (error) {
    // An unknown token and a spent one report identically from the service, so this
    // cannot be used to probe which invitations ever existed.
    return <InviteUnavailable message={toSafeError(error).message} />;
  }

  const context = await getUserContext();
  const signedInEmail = context?.user.email ?? null;
  const matches =
    signedInEmail !== null && signedInEmail.toLowerCase() === invite.email.toLowerCase();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex size-11 items-center justify-center rounded-md border border-primary-border bg-primary-surface text-primary">
          <Building2 className="size-5" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          You have been invited to {invite.workspaceName}
        </h1>
        <p className="text-sm text-muted-foreground">
          The invitation was sent to <span className="font-medium text-foreground">{invite.email}</span>{' '}
          for the role of{' '}
          <span className="font-medium text-foreground">{ROLE_LABELS[invite.role]}</span>.{' '}
          {ROLE_DESCRIPTIONS[invite.role]}
        </p>
      </div>

      {matches ? (
        <AcceptInviteForm token={token} workspaceName={invite.workspaceName} />
      ) : signedInEmail ? (
        <WrongAccount token={token} signedInEmail={signedInEmail} invitedEmail={invite.email} />
      ) : (
        <NotSignedIn token={token} />
      )}
    </div>
  );
}

function NotSignedIn({ token }: { token: string }) {
  const query = `?invite=${encodeURIComponent(token)}`;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Create your own sign-in to continue. It takes a minute, and you will come straight back here.
      </p>
      <Button asChild className="w-full">
        <Link href={`/signup${query}`}>
          <UserPlus aria-hidden />
          Create your account
        </Link>
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link href={`/login${query}`}>
          <LogIn aria-hidden />
          I already have an account
        </Link>
      </Button>
    </div>
  );
}

/**
 * Signed in, but as somebody else.
 *
 * The way out is to sign out and back in as the invited address, so that is the
 * button offered rather than a message that leaves them stuck.
 */
function WrongAccount({
  token,
  signedInEmail,
  invitedEmail,
}: {
  token: string;
  signedInEmail: string;
  invitedEmail: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="warning">
        <AlertCircle aria-hidden />
        <AlertTitle>You are signed in as {signedInEmail}</AlertTitle>
        <AlertDescription>
          This invitation was sent to {invitedEmail}. Sign in with that account to accept it — an
          invitation belongs to one person, so it cannot be moved to another account.
        </AlertDescription>
      </Alert>
      <form action={logoutAction}>
        {/* Carries them back here after signing out, rather than to a bare login
            screen with the invitation lost. */}
        <input type="hidden" name="invite" value={token} />
        <Button type="submit" variant="outline" className="w-full">
          Sign out and use a different account
        </Button>
      </form>
    </div>
  );
}

function InviteUnavailable({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex size-11 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          <AlertCircle className="size-5" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">This invitation cannot be used</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button asChild variant="outline" className="w-full">
        <Link href="/login">Go to sign in</Link>
      </Button>
    </div>
  );
}
