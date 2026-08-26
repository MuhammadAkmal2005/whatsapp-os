'use server';

/**
 * Authentication server actions.
 *
 * Thin adapters over the auth service: validate the form with the shared schema,
 * delegate the security-sensitive work, set the session cookie, and redirect.
 * `redirect()` throws a control-flow signal Next.js catches, so it is always
 * called *after* the try/catch — catching it would turn a successful login into
 * a form error.
 *
 * The cookie is set here rather than in the service because only the adapter
 * layer may touch `next/headers`; the service stays framework-free and returns
 * the issued token for exactly this step.
 */

import { redirect } from 'next/navigation';

import type { FormState } from '@/lib/form-state';
import { getSessionToken, setSessionCookie, clearSessionCookie, clearActiveWorkspaceCookie } from '@/server/auth/cookies';
import { getSessionActor } from '@/server/tenancy/resolve';
import { getRequestMeta } from '@/server/http/request-meta';
import { login, logout, signup } from '@/server/services/auth/auth.service';
import {
  formErrorFrom,
  pendingInviteToken,
  resolveActiveWorkspaceDestination,
  validationFormState,
} from '@/server/actions/action-helpers';
import { loginSchema, signupSchema } from '@/server/validation/auth';

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  // Read before the try: a redirect throws, so anything computed after the await
  // chain has to be in scope outside it.
  const invited = pendingInviteToken(formData.get('invite'));

  try {
    const meta = await getRequestMeta();
    const { session } = await signup({ ...parsed.data, meta });
    await setSessionCookie(session.token, session.expiresAt);
  } catch (error) {
    return formErrorFrom(error);
  }

  // A new account has no workspace of its own, so it is onboarding — unless they
  // arrived from an invitation, in which case they are joining someone else's
  // business and being asked to create one would be the wrong question.
  redirect(invited ? `/invite/${invited}` : '/onboarding');
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  const invited = pendingInviteToken(formData.get('invite'));

  let destination = '/onboarding';
  try {
    const meta = await getRequestMeta();
    const { user, session } = await login({ ...parsed.data, meta });
    await setSessionCookie(session.token, session.expiresAt);
    destination = invited
      ? `/invite/${invited}`
      : await resolveActiveWorkspaceDestination(user.id);
  } catch (error) {
    return formErrorFrom(error);
  }

  redirect(destination);
}

/**
 * Used directly as a `<form action={logoutAction}>`. Revokes the session
 * server-side (so the token is dead even if the cookie lingers), clears both
 * cookies, and returns to the login screen.
 *
 * An optional `invite` field lets the invitation flow send them back to the same
 * link afterwards, which matters when the reason they are signing out is that they
 * were signed in as the wrong person. The value is revalidated, so a crafted post
 * cannot turn sign-out into a redirect anywhere else.
 */
export async function logoutAction(formData?: FormData): Promise<void> {
  const invited = pendingInviteToken(formData?.get('invite'));

  const token = await getSessionToken();
  if (token) {
    const actor = await getSessionActor();
    const meta = await getRequestMeta();
    await logout({ token, actorUserId: actor?.user.id ?? null, meta });
  }
  await clearSessionCookie();
  await clearActiveWorkspaceCookie();

  redirect(invited ? `/login?invite=${encodeURIComponent(invited)}` : '/login');
}
