/**
 * Recognising an invitation token.
 *
 * Pure and dependency-free so it can be unit-tested directly. It is separated from
 * the server action that uses it because of what it guards: the token is
 * concatenated into a redirect path, so a value like `//evil.example` or
 * `../../dashboard` must be *rejected* rather than escaped, and a guard worth
 * having is a guard with tests against exactly those inputs.
 *
 * This is a shape check, not an authorisation check. A well-formed token still has
 * to be found in the database, unexpired, unrevoked and unaccepted, and the
 * signed-in account's email still has to match the invited address.
 */

/**
 * Base64url — the alphabet `randomBytes(n).toString('base64url')` produces. No
 * padding, no slashes, no dots, so no path separators and no traversal.
 *
 * The floor is well below a real 32-byte token (43 characters) but high enough to
 * reject obvious junk; the ceiling matches the invite schema's, so an oversized
 * value never reaches a database read.
 */
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Whether `value` could be an invitation token. Anchored, so a valid token
 *  embedded in a longer hostile string does not pass. */
export function isInviteToken(value: unknown): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value);
}

/**
 * The token from an untrusted source, or null.
 *
 * Trims first, because a token pasted out of a chat message often arrives with
 * whitespace around it, and that is a formatting accident rather than a bad token.
 */
export function parseInviteToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isInviteToken(trimmed) ? trimmed : null;
}
