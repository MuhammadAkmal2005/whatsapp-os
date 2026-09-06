/**
 * CSRF state for the Embedded Signup callback.
 *
 * The problem this solves: the browser hands us an authorization code and a set of
 * asset ids. Without a bound state value, anyone who can make an authenticated
 * request could post a code they obtained elsewhere and have this workspace connect a
 * WhatsApp account it does not own — or, worse, have *their* code land in someone
 * else's workspace.
 *
 * Stateless and HMAC-signed rather than a database row, for two reasons. The callback
 * already requires a live tenant context, so a state token is a second factor rather
 * than the only one; and Meta's authorization code expires in about 30 seconds, which
 * makes a persisted nonce table something that would be written and read once and then
 * accumulate rows forever.
 *
 * What the signature binds:
 *   - the workspace the flow started in, so a code cannot be replayed into another
 *     tenant even by the same user,
 *   - the membership that started it, so an actor who has since been removed cannot
 *     complete a flow they began,
 *   - a random nonce, so two flows are never the same string,
 *   - a short expiry, so a leaked state value stops working in minutes.
 *
 * The token is not a secret — it travels through the browser by design — so it is
 * signed, not encrypted. It carries no credential.
 */

import 'server-only';

import { env } from '@/config/env';
import { generateToken, hmacSha256Hex, verifyHmacSha256 } from '@/lib/crypto';

/**
 * Long enough for a business to read Meta's dialogs — which include phone
 * verification — and short enough that a state value found in a browser history is
 * useless.
 */
const STATE_TTL_SECONDS = 15 * 60;

const STATE_VERSION = 'v1';

/**
 * Domain separation. `AUTH_SECRET` also keys session hashing and token encryption; a
 * signature valid here must not be a signature valid anywhere else.
 */
const STATE_SECRET_CONTEXT = 'convonexa:meta-signup-state:v1';

type StatePayload = {
  /** Workspace id. */
  w: string;
  /** Membership id of the actor who started the flow. */
  m: string;
  /** Nonce. */
  n: string;
  /** Expiry, epoch seconds. */
  e: number;
};

export type SignupStateClaims = {
  workspaceId: string;
  membershipId: string;
  expiresAt: Date;
};

function stateSecret(): string {
  return `${STATE_SECRET_CONTEXT}:${env.AUTH_SECRET}`;
}

function encodePayload(payload: StatePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Issues a state token for a signup flow starting now. */
export function createSignupState(params: {
  workspaceId: string;
  membershipId: string;
  now?: Date;
}): string {
  const nowSeconds = Math.floor((params.now?.getTime() ?? Date.now()) / 1000);
  const encoded = encodePayload({
    w: params.workspaceId,
    m: params.membershipId,
    n: generateToken(16),
    e: nowSeconds + STATE_TTL_SECONDS,
  });

  return `${STATE_VERSION}.${encoded}.${hmacSha256Hex(stateSecret(), encoded)}`;
}

/**
 * Verifies a state token and returns its claims, or null if it is not usable.
 *
 * Null rather than a thrown error with a reason: the caller's only correct response to
 * any failure is to refuse the callback, and distinguishing "bad signature" from
 * "expired" in a response would tell an attacker which half to work on.
 */
export function verifySignupState(token: string, now: Date = new Date()): SignupStateClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [version, encoded, signature] = parts;
  if (version !== STATE_VERSION || !encoded || !signature) return null;

  // Constant-time comparison inside verifyHmacSha256.
  if (!verifyHmacSha256(stateSecret(), encoded, signature)) return null;

  let payload: StatePayload;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof decoded !== 'object' || decoded === null) return null;
    const candidate = decoded as Partial<StatePayload>;
    if (
      typeof candidate.w !== 'string' ||
      typeof candidate.m !== 'string' ||
      typeof candidate.n !== 'string' ||
      typeof candidate.e !== 'number'
    ) {
      return null;
    }
    payload = candidate as StatePayload;
  } catch {
    return null;
  }

  if (payload.e * 1000 <= now.getTime()) return null;

  return {
    workspaceId: payload.w,
    membershipId: payload.m,
    expiresAt: new Date(payload.e * 1000),
  };
}

/**
 * Whether a state token belongs to this actor in this workspace.
 *
 * Both halves matter. A valid signature only proves *we* issued the token; the
 * workspace and membership comparison is what proves it was issued to the person now
 * presenting it. The workspace id used here comes from the server-side tenant context,
 * never from the request body.
 */
export function signupStateMatchesActor(
  claims: SignupStateClaims | null,
  actor: { workspaceId: string; membershipId: string },
): boolean {
  if (!claims) return false;
  return claims.workspaceId === actor.workspaceId && claims.membershipId === actor.membershipId;
}
