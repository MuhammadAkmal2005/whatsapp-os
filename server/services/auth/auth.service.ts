/**
 * Authentication service: signup, login, logout.
 *
 * This layer owns the security-sensitive decisions and nothing about HTTP. It
 * returns a domain result and an issued session; the server action turns that
 * into a cookie and a redirect. Keeping it framework-free means the same rules
 * apply if login is ever driven from a script or a test.
 *
 * Two anti-enumeration measures matter here. Login returns one generic message
 * whether the email is unknown or the password is wrong, and burns an equivalent
 * amount of hashing work with `fakeVerify` when the account does not exist, so a
 * missing account and a wrong password are indistinguishable by both content and
 * timing. Signup does report that an email is already registered — a shop owner
 * needs to know to log in instead — which is a deliberate, bounded trade against
 * the tighter posture on login.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import {
  ConflictError,
  RateLimitError,
  UnauthenticatedError,
  ValidationError,
} from '@/server/errors';
import {
  checkPasswordStrength,
  fakeVerify,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '@/server/auth/password';
import { appendAuditLog, appendProductEvent } from '@/server/repositories/audit.repository';
import {
  createUser,
  emailExists,
  findUserByEmail,
  markLoginAt,
  updatePasswordHash,
} from '@/server/repositories/user.repository';
import { consumeDual } from '@/server/ratelimit/limiter';
import type { AuthenticatedUser } from '@/server/tenancy/context';
import { issueSession, type IssuedSession } from '@/server/services/auth/session.service';

export type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuthResult = {
  user: AuthenticatedUser;
  session: IssuedSession;
};

const GENERIC_LOGIN_FAILURE = 'That email or password is not correct.';

function toAuthenticatedUser(row: {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  avatarUrl: string | null;
}): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerifiedAt: row.emailVerifiedAt,
    avatarUrl: row.avatarUrl,
  };
}

/**
 * The limiter is defence in depth behind the password check, so a storage error
 * must not lock everyone out: it is logged and treated as "allowed". A blocked
 * decision, by contrast, is enforced.
 */
async function enforceRateLimit(
  action: 'login' | 'signup',
  meta: RequestMeta & { email: string },
): Promise<void> {
  try {
    const decision = await consumeDual(action, { email: meta.email, ip: meta.ipAddress });
    if (!decision.allowed) {
      throw new RateLimitError(decision.retryAfterSeconds);
    }
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    logger.warn('Rate-limit store unavailable; allowing request', { action });
  }
}

export async function signup(input: {
  name: string;
  email: string;
  password: string;
  meta?: RequestMeta;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const meta = input.meta ?? {};

  if (name.length < 1) {
    throw new ValidationError('Please enter your name.', { name: ['Please enter your name.'] });
  }

  await enforceRateLimit('signup', { ...meta, email });

  const strength = checkPasswordStrength(input.password, email);
  if (!strength.valid) {
    throw new ValidationError(strength.reason, { password: [strength.reason] });
  }

  if (await emailExists(prisma, email)) {
    // A bounded disclosure: the owner needs to be told to log in rather than
    // being stuck. Login remains non-enumerable, which is where it counts.
    throw new ConflictError('An account with this email already exists. Try logging in instead.');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await createUser(prisma, { email, name, passwordHash });

  const session = await issueSession({
    userId: user.id,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  await Promise.all([
    appendAuditLog(prisma, {
      action: 'user.signup',
      actorUserId: user.id,
      actorType: 'USER',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    }),
    appendProductEvent(prisma, { name: 'signup', userId: user.id }),
  ]).catch((error) => {
    // Analytics and audit are best-effort relative to account creation; a failure
    // here must not undo a successful signup the user is already holding a cookie
    // for. Logged so it is not silent.
    logger.error('Post-signup bookkeeping failed', { error: String(error), userId: user.id });
  });

  logger.info('User signed up', { userId: user.id });
  return { user: toAuthenticatedUser(user), session };
}

export async function login(input: {
  email: string;
  password: string;
  meta?: RequestMeta;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const meta = input.meta ?? {};

  await enforceRateLimit('login', { ...meta, email });

  const user = await findUserByEmail(prisma, email);

  if (!user) {
    // Equalise timing against the hashing a real account would trigger, so a
    // missing email cannot be told apart from a wrong password over the network.
    await fakeVerify();
    throw new UnauthenticatedError(GENERIC_LOGIN_FAILURE);
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw new UnauthenticatedError(GENERIC_LOGIN_FAILURE);
  }

  // Transparently upgrade a hash produced with weaker parameters, now that we
  // have the plaintext in hand. Best-effort: a failure must not block the login.
  if (needsRehash(user.passwordHash)) {
    hashPassword(input.password)
      .then((rehashed) => updatePasswordHash(prisma, user.id, rehashed))
      .catch((error) => logger.warn('Password rehash failed', { userId: user.id, error: String(error) }));
  }

  const now = new Date();
  await markLoginAt(prisma, user.id, now);

  const session = await issueSession({
    userId: user.id,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  await appendAuditLog(prisma, {
    action: 'user.login',
    actorUserId: user.id,
    actorType: 'USER',
    resourceType: 'user',
    resourceId: user.id,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  }).catch((error) => logger.error('Login audit failed', { userId: user.id, error: String(error) }));

  logger.info('User logged in', { userId: user.id });
  return { user: toAuthenticatedUser(user), session };
}

export async function logout(input: {
  token: string;
  actorUserId?: string | null;
  meta?: RequestMeta;
}): Promise<void> {
  const { revokeSession } = await import('@/server/services/auth/session.service');
  await revokeSession(input.token);

  if (input.actorUserId) {
    await appendAuditLog(prisma, {
      action: 'user.logout',
      actorUserId: input.actorUserId,
      actorType: 'USER',
      resourceType: 'user',
      resourceId: input.actorUserId,
      ipAddress: input.meta?.ipAddress ?? null,
      userAgent: input.meta?.userAgent ?? null,
    }).catch((error) => logger.error('Logout audit failed', { error: String(error) }));
  }
}
