/**
 * Session and active-workspace cookies.
 *
 * The only place cookie names, flags and lifetimes are set. Everything about the
 * session cookie is chosen to make it useless to anything but the browser it was
 * issued to: httpOnly keeps it out of reach of any script (so an XSS bug cannot
 * read it), `secure` keeps it off plaintext connections in production, and
 * `sameSite=lax` means it does not ride along on a cross-site POST, which is the
 * CSRF case that matters for a mutating request.
 *
 * The cookie value is the opaque token; the server hashes it to look up the
 * session. The cookie never carries identity, a role, or a workspace id — those
 * are resolved server-side from the session, because a value the browser holds
 * is a value an attacker can edit.
 */

import 'server-only';

import { cookies } from 'next/headers';

import { ACTIVE_WORKSPACE_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/config/constants';
import { isProduction } from '@/config/env';

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  path: '/',
} as const;

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    ...BASE_COOKIE_OPTIONS,
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  // maxAge 0 rather than delete(): explicit expiry is honoured consistently by
  // every client, and it overwrites the value rather than relying on removal.
  store.set(SESSION_COOKIE_NAME, '', { ...BASE_COOKIE_OPTIONS, maxAge: 0 });
}

/**
 * The active workspace is a convenience pointer, not an authorisation input.
 * Membership is always re-verified server-side against this slug, so a tampered
 * value resolves to "not a member" and the picker is shown — it can never grant
 * access to a workspace the user does not belong to.
 */
export async function getActiveWorkspaceSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_WORKSPACE_COOKIE_NAME)?.value ?? null;
}

export async function setActiveWorkspaceCookie(slug: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE_NAME, slug, {
    ...BASE_COOKIE_OPTIONS,
    // Outlives a session deliberately: returning users land back in the last
    // workspace they used without re-choosing.
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearActiveWorkspaceCookie(): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE_NAME, '', { ...BASE_COOKIE_OPTIONS, maxAge: 0 });
}
