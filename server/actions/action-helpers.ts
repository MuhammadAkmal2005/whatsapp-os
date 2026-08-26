/**
 * Shared helpers for server actions.
 *
 * Actions are thin adapters: parse the form, delegate to a service, translate
 * the outcome into a `FormState` or a redirect. The translation is identical
 * everywhere, so it lives here — a Zod failure becomes field errors, an
 * `AppError` becomes its safe message and code, and an unknown throw becomes a
 * generic sentence with a request id that ties the user's report to the log.
 */

import 'server-only';

import { z } from 'zod';

import { requestId } from '@/lib/ids';
import { parseInviteToken } from '@/lib/invite-token';
import { logger } from '@/lib/logger';
import type { FieldErrors, FormState } from '@/lib/form-state';
import { getActiveWorkspaceSlug, setActiveWorkspaceCookie } from '@/server/auth/cookies';
import { isAppError, toSafeError } from '@/server/errors';
import { listUserWorkspaces } from '@/server/services/workspace/workspace.service';

/** Collapses a Zod error into per-field messages the form can render inline. */
export function zodToFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function validationFormState(error: z.ZodError): FormState {
  return {
    status: 'error',
    message: 'Please check the highlighted fields and try again.',
    fieldErrors: zodToFieldErrors(error),
  };
}

/**
 * Turns any thrown value into a safe `FormState`. An unexposed or unknown error
 * is logged in full against the returned request id; the user only ever sees a
 * stable code and a sentence.
 */
export function formErrorFrom(error: unknown): FormState {
  const id = requestId();
  const safe = toSafeError(error);

  if (!isAppError(error)) {
    logger.error('Unhandled error in server action', { requestId: id, error: String(error) });
  } else if (!error.expose) {
    logger.error('Server action failed', {
      requestId: id,
      code: error.code,
      cause: String(error.cause ?? ''),
    });
  }

  return {
    status: 'error',
    message: safe.message,
    ...(safe.details ? { fieldErrors: safe.details } : {}),
    requestId: id,
  };
}

/**
 * Where a freshly-authenticated user should land, setting the active-workspace
 * cookie as a side effect.
 *
 * No workspace yet → onboarding. Otherwise prefer the workspace they last had
 * active (if they still belong to it), else the most recently used, and send
 * them to the dashboard. This is why login does not hard-code `/dashboard`: a
 * brand-new account has nowhere to be a dashboard for yet.
 */
export async function resolveActiveWorkspaceDestination(userId: string): Promise<string> {
  const workspaces = await listUserWorkspaces(userId);
  if (workspaces.length === 0) return '/onboarding';

  const current = await getActiveWorkspaceSlug();
  const chosen = workspaces.find((workspace) => workspace.slug === current) ?? workspaces[0];
  if (!chosen) return '/onboarding';

  await setActiveWorkspaceCookie(chosen.slug);
  return '/dashboard';
}

/**
 * The invitation the person was in the middle of accepting, if any.
 *
 * Someone who follows an invite link without an account signs up first, and would
 * otherwise land in onboarding and be asked to create a business — exactly the
 * wrong thing, since they were invited to join one. Login and signup carry the
 * token through in a hidden field so they can be sent back to it.
 *
 * Returns null for anything that is not a well-formed token, so a malformed or
 * hostile value degrades to the normal destination instead of steering a redirect.
 * The shape check lives in `lib/invite-token` where it can be tested against the
 * traversal and protocol-relative inputs it exists to reject.
 */
export function pendingInviteToken(raw: FormDataEntryValue | null | undefined): string | null {
  return parseInviteToken(raw);
}
