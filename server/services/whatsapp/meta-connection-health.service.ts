/**
 * Whether a connected number actually works, established by asking Meta.
 *
 * The indicator this replaces was `status === 'CONNECTED'`, which in practice meant a row
 * held a token. That is not a health check: a token can be revoked in Business Manager, a
 * subscription can be removed by the business, a number can be deregistered, and none of
 * those events notify us. A green tick in any of those states is worse than no tick,
 * because the owner stops looking.
 *
 * Four questions are asked, in increasing cost, and every answer is evidence:
 *   1. Is there a token at all, and has it expired by the clock we already hold?
 *   2. Can we still read the phone number with it? (proves the token and the grant)
 *   3. Does Meta list this app on the WABA's subscription edge? (proves delivery)
 *   4. Has anything actually flowed recently? (the only proof that is not Meta's opinion)
 *
 * Questions 2 and 3 cost a Graph round trip each, so the check is rate-limited per account
 * and every path writes `lastHealthCheckAt` — a health panel that hammers Meta on every
 * page render would get the deployment throttled.
 */

import 'server-only';

import { env, isWhatsAppMocked } from '@/config/env';
import { prisma } from '@/db/prisma';
import { decryptSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { NotFoundError } from '@/server/errors';
import {
  findAccountsWithPhoneNumbers,
  updateAccountConnectionState,
  type ChannelStatus,
  type WhatsAppAccountRow,
} from '@/server/repositories/whatsapp-account.repository';
import {
  metaGraphClient,
  type MetaGraphClient,
} from '@/server/services/whatsapp/meta-graph.client';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import { emitConnectionHealthFailed } from '@/server/telemetry/meta-events';

/**
 * How long a live check's verdict is trusted before Meta is asked again.
 *
 * Five minutes: long enough that opening the settings page repeatedly costs one round trip,
 * short enough that a revoked token is noticed within a coffee break.
 */
const HEALTH_CHECK_TTL_MS = 5 * 60 * 1000;

/** A token inside this window is reported as expiring so it can be replaced in time. */
const TOKEN_EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A number that has neither received nor sent anything for this long is reported as quiet.
 *
 * Quiet is explicitly *not* unhealthy. A small shop can go a day without a message, and
 * calling that broken would train the owner to ignore the panel.
 */
const ACTIVITY_QUIET_MS = 7 * 24 * 60 * 60 * 1000;

export type HealthCheckName =
  | 'token_present'
  | 'token_expiry'
  | 'phone_number_readable'
  | 'webhook_subscription'
  | 'recent_activity';

export type HealthCheckState = 'pass' | 'warn' | 'fail' | 'skipped';

export type HealthCheck = {
  name: HealthCheckName;
  state: HealthCheckState;
  /** One sentence, written for a shop owner, safe to render verbatim. */
  detail: string;
};

export type ConnectionHealthReport = {
  accountId: string;
  /** The status this evidence supports, which the account row is updated to match. */
  status: ChannelStatus;
  checkedAt: Date;
  /** False when the report was served from the last live check rather than re-asking Meta. */
  live: boolean;
  checks: readonly HealthCheck[];
};

export type RunHealthCheckOptions = {
  /** Ignore the TTL. Used by the explicit "check now" button. */
  force?: boolean;
  graph?: MetaGraphClient;
};

function check(name: HealthCheckName, state: HealthCheckState, detail: string): HealthCheck {
  return { name, state, detail };
}

/**
 * Collapses individual findings into the one word the UI shows.
 *
 * A fail anywhere means DEGRADED rather than ERROR: the distinction we keep is between "this
 * connection has a problem you can fix" and "Meta refused our last real request", and the
 * latter is written by the send path, which has actual evidence of refusal. Overwriting it
 * here from a health probe would erase the more specific fact.
 */
function statusFor(checks: readonly HealthCheck[], current: ChannelStatus): ChannelStatus {
  if (checks.some((entry) => entry.name === 'token_present' && entry.state === 'fail')) {
    return 'DISCONNECTED';
  }
  if (checks.some((entry) => entry.state === 'fail')) return 'DEGRADED';
  if (current === 'PENDING') return 'CONNECTED';
  return current === 'ERROR' ? 'ERROR' : 'CONNECTED';
}

/**
 * Runs the checks for one account.
 *
 * Read-only towards Meta — nothing here subscribes, registers or repairs. A check that
 * silently fixed things would make the panel a liar about what the state had been, and a
 * repair is a decision for the owner.
 */
export async function runConnectionHealthCheck(
  ctx: TenantContext,
  accountId: string,
  options?: RunHealthCheckOptions,
): Promise<ConnectionHealthReport> {
  requirePermission(ctx, 'whatsapp:read');

  // One workspace-scoped read gives both the account and its numbers. A workspace holds
  // one or two of these, so filtering in memory costs less than a second query.
  const accounts = await findAccountsWithPhoneNumbers(prisma, ctx.workspaceId);
  const account = accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new NotFoundError(`WhatsAppAccount with id "${accountId}"`);
  }

  const now = new Date();
  const lastCheck = account.lastHealthCheckAt?.getTime() ?? 0;
  const fresh = now.getTime() - lastCheck < HEALTH_CHECK_TTL_MS;

  if (!options?.force && fresh) {
    return {
      accountId,
      status: account.status,
      checkedAt: account.lastHealthCheckAt ?? now,
      live: false,
      checks: describeFromRow(account, now),
    };
  }

  const checks: HealthCheck[] = [];

  if (!account.accessTokenEncrypted) {
    checks.push(
      check(
        'token_present',
        'fail',
        'This number is disconnected. Connect it again to start receiving messages.',
      ),
    );
    return finish(ctx, account, checks, now);
  }
  checks.push(check('token_present', 'pass', 'An access token is stored for this number.'));
  checks.push(tokenExpiryCheck(account.tokenExpiresAt, now));

  if (account.isMock || isWhatsAppMocked) {
    checks.push(
      check(
        'phone_number_readable',
        'skipped',
        'This workspace is in test mode, so nothing is checked against Meta.',
      ),
      check('webhook_subscription', 'skipped', 'Not checked in test mode.'),
    );
    checks.push(activityCheck(account, now));
    return finish(ctx, account, checks, now);
  }

  const graph = options?.graph ?? metaGraphClient;

  let accessToken: string;
  try {
    accessToken = decryptSecret(account.accessTokenEncrypted, env.AUTH_SECRET);
  } catch {
    // A token we cannot decrypt is a token we cannot use. Most likely cause is an
    // `AUTH_SECRET` rotation, which is worth saying plainly rather than reporting as a
    // Meta problem.
    checks.push(
      check(
        'phone_number_readable',
        'fail',
        'The stored access token could not be read on this server. Reconnect this number.',
      ),
    );
    return finish(ctx, account, checks, now);
  }

  const defaultPhone =
    account.phoneNumbers.find((phone) => phone.isDefault) ?? account.phoneNumbers[0];

  checks.push(await phoneReadableCheck(graph, accessToken, defaultPhone?.phoneNumberId));
  checks.push(await subscriptionCheck(graph, accessToken, account.wabaId));
  checks.push(activityCheck(account, now));

  return finish(ctx, account, checks, now);
}

/**
 * Every connection in the workspace, for the settings page.
 *
 * Uses the cached path so opening the page is one database read in the common case; the
 * "check now" button is what forces a live round trip.
 */
export async function getConnectionHealthReports(
  ctx: TenantContext,
): Promise<ConnectionHealthReport[]> {
  requirePermission(ctx, 'whatsapp:read');

  const accounts = await findAccountsWithPhoneNumbers(prisma, ctx.workspaceId);
  const now = new Date();

  return accounts.map((account) => ({
    accountId: account.id,
    status: account.status,
    checkedAt: account.lastHealthCheckAt ?? now,
    live: false,
    checks: describeFromRow(account, now),
  }));
}

function tokenExpiryCheck(expiresAt: Date | null, now: Date): HealthCheck {
  if (!expiresAt) {
    return check(
      'token_expiry',
      'pass',
      'This access token does not expire, so it will not need replacing.',
    );
  }

  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= 0) {
    return check(
      'token_expiry',
      'fail',
      'The access token for this number has expired. Reconnect to restore messaging.',
    );
  }
  if (remaining < TOKEN_EXPIRY_WARNING_MS) {
    const days = Math.max(1, Math.round(remaining / (24 * 60 * 60 * 1000)));
    return check(
      'token_expiry',
      'warn',
      `The access token for this number expires in ${days} day${days === 1 ? '' : 's'}. Reconnect before then.`,
    );
  }
  return check('token_expiry', 'pass', 'The access token is valid.');
}

async function phoneReadableCheck(
  graph: MetaGraphClient,
  accessToken: string,
  phoneNumberId: string | undefined,
): Promise<HealthCheck> {
  if (!phoneNumberId) {
    return check(
      'phone_number_readable',
      'fail',
      'No WhatsApp number is registered on this account yet.',
    );
  }

  try {
    await graph.getPhoneNumber({ phoneNumberId, accessToken });
    return check('phone_number_readable', 'pass', 'Meta confirms this number and our access to it.');
  } catch (error) {
    logger.warn('meta.health.phone_read_failed', {
      phoneNumberId,
      error: error instanceof Error ? error.message : String(error),
    });
    return check(
      'phone_number_readable',
      'fail',
      'Meta would not confirm this number with the stored access token. It may have been revoked in Business Manager.',
    );
  }
}

/**
 * The check that decides whether inbound messages can arrive at all.
 *
 * A GET on `/<WABA_ID>/subscribed_apps` listing our app id is the only evidence that Meta
 * will deliver to this deployment. Everything else about a connection can look right while
 * this is false, which is exactly the failure the old indicator could not see.
 */
async function subscriptionCheck(
  graph: MetaGraphClient,
  accessToken: string,
  wabaId: string,
): Promise<HealthCheck> {
  try {
    const subscriptions = await graph.listWabaSubscriptions({ wabaId, accessToken });
    const subscribed = env.META_APP_ID
      ? subscriptions.some((entry) => entry.whatsappBusinessApiDataAppId === env.META_APP_ID)
      : subscriptions.length > 0;

    return subscribed
      ? check('webhook_subscription', 'pass', 'Meta is delivering incoming messages to ConvoNexa.')
      : check(
          'webhook_subscription',
          'fail',
          'Meta is not delivering incoming messages to ConvoNexa for this account. Reconnect this number to restore it.',
        );
  } catch (error) {
    logger.warn('meta.health.subscription_read_failed', {
      wabaId,
      error: error instanceof Error ? error.message : String(error),
    });
    return check(
      'webhook_subscription',
      'warn',
      'We could not check with Meta whether incoming messages are being delivered.',
    );
  }
}

function activityCheck(
  account: { lastInboundEventAt: Date | null; lastOutboundSuccessAt: Date | null },
  now: Date,
): HealthCheck {
  const last = Math.max(
    account.lastInboundEventAt?.getTime() ?? 0,
    account.lastOutboundSuccessAt?.getTime() ?? 0,
  );

  if (last === 0) {
    return check(
      'recent_activity',
      'warn',
      'No message has been sent or received on this number yet. Send yourself a test message to confirm it works.',
    );
  }
  if (now.getTime() - last > ACTIVITY_QUIET_MS) {
    return check(
      'recent_activity',
      'warn',
      'Nothing has been sent or received on this number in the last week.',
    );
  }
  return check('recent_activity', 'pass', 'Messages have flowed on this number recently.');
}

/**
 * Rebuilds a report from the row alone, for the cached path.
 *
 * Deliberately fewer checks than the live path — it reports only what the row can honestly
 * support, and never claims a Meta-confirmed subscription it did not just verify.
 */
function describeFromRow(
  account: {
    accessTokenEncrypted: string | null;
    tokenExpiresAt: Date | null;
    subscriptionVerifiedAt: Date | null;
    lastInboundEventAt: Date | null;
    lastOutboundSuccessAt: Date | null;
  },
  now: Date,
): HealthCheck[] {
  const checks: HealthCheck[] = [];

  checks.push(
    account.accessTokenEncrypted
      ? check('token_present', 'pass', 'An access token is stored for this number.')
      : check('token_present', 'fail', 'This number is disconnected.'),
  );
  checks.push(tokenExpiryCheck(account.tokenExpiresAt, now));
  checks.push(
    account.subscriptionVerifiedAt
      ? check(
          'webhook_subscription',
          'pass',
          'Meta confirmed message delivery to ConvoNexa at the last check.',
        )
      : check(
          'webhook_subscription',
          'warn',
          'Message delivery to ConvoNexa has not been confirmed with Meta yet.',
        ),
  );
  checks.push(activityCheck(account, now));

  return checks;
}

/** Writes the verdict back and returns the report. */
async function finish(
  ctx: TenantContext,
  account: WhatsAppAccountRow,
  checks: HealthCheck[],
  now: Date,
): Promise<ConnectionHealthReport> {
  const status = statusFor(checks, account.status);
  const failed = checks.find((entry) => entry.state === 'fail');
  const subscriptionConfirmed = checks.some(
    (entry) => entry.name === 'webhook_subscription' && entry.state === 'pass',
  );

  await updateAccountConnectionState(prisma, ctx.workspaceId, account.id, {
    status,
    lastHealthCheckAt: now,
    ...(subscriptionConfirmed && { subscriptionVerifiedAt: now }),
    // Only the health-owned fields are touched. A send failure's error code stays put unless
    // this check found its own reason to overwrite it.
    ...(failed
      ? { lastErrorCode: failed.name, lastErrorMessage: failed.detail, lastErrorAt: now }
      : {}),
  });

  if (failed) {
    await emitConnectionHealthFailed(prisma, {
      workspaceId: ctx.workspaceId,
      accountId: account.id,
      reason: failed.name,
    });
  }

  return { accountId: account.id, status, checkedAt: now, live: true, checks };
}
