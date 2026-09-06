/**
 * The one path a WhatsApp number takes to become connected.
 *
 * Both onboarding routes end here: Embedded Signup, where Meta hands the browser an
 * authorization code, and the manual System User token a business pastes in. They differ
 * only in how the access token is obtained. Everything after that — what the token is
 * allowed to touch, whether the WABA is really ours to use, whether Meta will actually
 * deliver webhooks to us, whether the number can send — is verified identically, because
 * a connection made one way must be exactly as trustworthy as one made the other way.
 *
 * The ordering below is the security argument, so it is worth stating plainly. The client
 * tells us which WABA and which phone number it wants connected. We believe none of it.
 * The token is exchanged server-side, the WABA is read back with that token, and the
 * phone number must appear in the list Meta returns for that WABA. A caller who posts
 * someone else's `phone_number_id` gets a validation error, because the only ids that
 * survive are the ones Meta itself just told us the token grants.
 *
 * The second argument is about honesty. `CONNECTED` here means Meta confirmed, on a read
 * of `/<WABA_ID>/subscribed_apps`, that this app is subscribed — not that a token was
 * stored. When subscription or registration cannot be proven the account is persisted as
 * `DEGRADED` with the reason attached, because a business that can see "messages may not
 * arrive, here is why" can act, and one shown a green tick cannot.
 */

import 'server-only';

import { env, isEmbeddedSignupConfigured, isWhatsAppMocked } from '@/config/env';
import { prisma } from '@/db/prisma';
import { encryptSecret, generateNumericPin } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { ValidationError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  findAccountOwnerByWabaId,
  findPhoneNumberWithAccountByPhoneNumberId,
  markPhoneNumberRegistered,
  updateAccountConnectionState,
  upsertWhatsAppAccountWithPhoneNumber,
  type ChannelStatus,
  type MetaConnectionMethod,
  type MetaTokenType,
  type WhatsAppAccountWithPhoneNumbersRow,
} from '@/server/repositories/whatsapp-account.repository';
import { assertWithinPlanLimit } from '@/server/services/billing/limit-guard.service';
import {
  metaGraphClient,
  type MetaGraphClient,
  type MetaPhoneNumberSummary,
  type MetaWabaSummary,
} from '@/server/services/whatsapp/meta-graph.client';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import {
  emitConnectionFailed,
  emitConnectionStarted,
  emitConnectionSucceeded,
} from '@/server/telemetry/meta-events';

/** Registration PINs are six digits because Meta's `register` endpoint accepts six digits. */
const REGISTRATION_PIN_LENGTH = 6;

/**
 * What went wrong, at the granularity a business owner can act on.
 *
 * Mirrors the telemetry stage labels so a dashboard and a support conversation use the
 * same vocabulary.
 */
export type ConnectionStage =
  | 'token_exchange'
  | 'asset_verification'
  | 'subscription'
  | 'registration'
  | 'persistence';

/**
 * A non-fatal problem with a connection that was still worth keeping.
 *
 * Carries a stable `code` for tests and telemetry alongside the sentence shown on the
 * settings screen, so the copy can be rewritten without breaking an assertion.
 */
export type ConnectionWarning = {
  code:
    | 'token_unverifiable'
    | 'token_foreign_app'
    | 'subscription_failed'
    | 'subscription_unconfirmed'
    | 'registration_failed'
    | 'registration_skipped_unverified';
  message: string;
};

export type MetaConnectionResult = {
  accountId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  status: ChannelStatus;
  /** True only when a read of the subscription edge confirmed this app. */
  subscriptionConfirmed: boolean;
  /** True when the number is on Cloud API, whether we registered it or found it so. */
  registered: boolean;
  warnings: readonly ConnectionWarning[];
  account: WhatsAppAccountWithPhoneNumbersRow;
};

/**
 * Everything the pipeline needs, with the token already in hand.
 *
 * `claimedWabaId` and `claimedPhoneNumberId` are named for what they are: assertions from
 * a client, to be checked against Meta and discarded if they do not hold.
 */
export type EstablishConnectionParams = {
  method: MetaConnectionMethod;
  accessToken: string;
  tokenType: MetaTokenType;
  /** From the code exchange when Meta gave one; null for non-expiring System User tokens. */
  tokenExpiresAt: Date | null;
  claimedWabaId: string;
  claimedPhoneNumberId: string;
  /**
   * A name the owner typed for this connection. It wins over Meta's own WABA name,
   * because a shop that called it "Retail counter" meant that and not the legal entity.
   */
  preferredDisplayName?: string | null;
  /**
   * What the owner typed. Used only in mock mode, where there is no Meta to ask; a live
   * connection always takes the number Meta reports, because that is the one customers
   * actually message.
   */
  fallbackDisplayPhoneNumber?: string;
  /** Test seam, and the way a caller supplies a stubbed Graph transport. */
  graph?: MetaGraphClient;
  /** Set by the mock path; production leaves it alone. */
  forceMock?: boolean;
};

function pin(): string {
  return generateNumericPin(REGISTRATION_PIN_LENGTH);
}

/**
 * Turns a Graph failure into something a shop owner can read, without echoing Meta's
 * internals or the token.
 *
 * The detail still reaches the logs through the Graph client, which already logged the
 * status, the Meta code and the `fbtrace_id` before throwing.
 */
function connectionError(stage: ConnectionStage, error: unknown): ValidationError {
  const fallback =
    stage === 'token_exchange'
      ? 'WhatsApp did not accept that sign-in. Please start the connection again.'
      : 'WhatsApp would not confirm those details. Check the account you selected and try again.';

  // An AppError we raised deliberately already carries owner-safe copy; anything else
  // is a transport or provider failure whose message is not for a customer to read.
  if (error instanceof ValidationError) return error;
  return new ValidationError(fallback);
}

/**
 * Reads the token back from Meta to learn what it is.
 *
 * Advisory on purpose. `debug_token` is only answerable by the app that issued the token,
 * so a System User token created inside a business's own app cannot be inspected with our
 * app credentials — a 403 here is a legitimate setup, not a bad token. The decisive test
 * for "will messages reach us" is the subscription read further down, which is why a
 * failure to introspect degrades to a warning rather than refusing the connection.
 */
async function introspectToken(
  graph: MetaGraphClient,
  accessToken: string,
): Promise<{ expiresAt: Date | null; warnings: ConnectionWarning[] }> {
  const warnings: ConnectionWarning[] = [];

  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    return { expiresAt: null, warnings };
  }

  try {
    const debug = await graph.debugToken(accessToken);

    if (!debug.isValid) {
      throw new ValidationError(
        'WhatsApp reports that access token is no longer valid. Generate a new one and try again.',
      );
    }

    if (debug.appId && debug.appId !== env.META_APP_ID) {
      warnings.push({
        code: 'token_foreign_app',
        message:
          'That access token belongs to a different Meta app. Messages will only reach this inbox while this app stays subscribed to your WhatsApp account.',
      });
    }

    return { expiresAt: debug.expiresAt, warnings };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    warnings.push({
      code: 'token_unverifiable',
      message:
        'We could not check when this access token expires, so we cannot warn you before it does.',
    });
    return { expiresAt: null, warnings };
  }
}

/**
 * Proves the token grants the WABA, and that the phone number really belongs to it.
 *
 * This is the function that makes a client-posted `phone_number_id` harmless: the returned
 * summary comes from Meta's list for that WABA, so an id that is not on it never reaches
 * the database.
 */
async function verifyAssets(
  graph: MetaGraphClient,
  params: { accessToken: string; wabaId: string; phoneNumberId: string },
): Promise<{ waba: MetaWabaSummary; phone: MetaPhoneNumberSummary }> {
  const waba = await graph.getWaba({ wabaId: params.wabaId, accessToken: params.accessToken });

  const numbers = await graph.listWabaPhoneNumbers({
    wabaId: params.wabaId,
    accessToken: params.accessToken,
  });

  const phone = numbers.find((entry) => entry.id === params.phoneNumberId);
  if (!phone) {
    throw new ValidationError(
      'That phone number is not on the WhatsApp Business account you selected. Pick a number that belongs to it.',
    );
  }

  return { waba, phone };
}

/**
 * Refuses a WABA or a number that another workspace already holds.
 *
 * Both checks are cross-tenant by necessity — a WhatsApp asset belongs to exactly one
 * workspace platform-wide — and neither returns anything about the other tenant beyond
 * the fact that the asset is taken.
 */
async function assertAssetsUnclaimed(
  workspaceId: string,
  params: { wabaId: string; phoneNumberId: string },
): Promise<{ isUpdate: boolean }> {
  const wabaOwner = await findAccountOwnerByWabaId(prisma, params.wabaId);
  if (wabaOwner && wabaOwner.workspaceId !== workspaceId) {
    throw new ValidationError(
      'This WhatsApp Business account is already connected to another ConvoNexa workspace. Disconnect it there first.',
    );
  }

  const phoneOwner = await findPhoneNumberWithAccountByPhoneNumberId(
    prisma,
    params.phoneNumberId,
  );
  if (phoneOwner && phoneOwner.workspaceId !== workspaceId) {
    throw new ValidationError(
      'This WhatsApp phone number is already connected to another ConvoNexa workspace. Disconnect it there first.',
    );
  }

  return { isUpdate: Boolean(wabaOwner ?? phoneOwner) };
}

/**
 * Subscribes this app to the WABA, then reads the edge back to prove it took.
 *
 * The read is the whole point. `POST /subscribed_apps` returning `{"success": true}` is
 * Meta accepting the request; only a GET that lists our app id is evidence that a customer
 * message will be delivered here. Phase 11 of the brief is explicit about not inferring a
 * subscription from the existence of a callback endpoint, and this is where that is honoured.
 */
async function subscribeAndConfirm(
  graph: MetaGraphClient,
  params: { wabaId: string; accessToken: string },
): Promise<{ confirmed: boolean; warnings: ConnectionWarning[] }> {
  const warnings: ConnectionWarning[] = [];

  try {
    await graph.subscribeAppToWaba(params);
  } catch (error) {
    logger.warn('meta.onboarding.subscribe_failed', {
      wabaId: params.wabaId,
      error: error instanceof Error ? error.message : String(error),
    });
    warnings.push({
      code: 'subscription_failed',
      message:
        'Meta would not let us subscribe to this account, so incoming messages may not arrive. Check that ConvoNexa has WhatsApp permissions in your Business Manager.',
    });
    // Still fall through to the read: a prior subscription may already be in place, and
    // an existing one is what actually matters.
  }

  try {
    const subscriptions = await graph.listWabaSubscriptions(params);
    const confirmed = env.META_APP_ID
      ? subscriptions.some((entry) => entry.whatsappBusinessApiDataAppId === env.META_APP_ID)
      : subscriptions.length > 0;

    if (!confirmed) {
      warnings.push({
        code: 'subscription_unconfirmed',
        message:
          'Meta does not list ConvoNexa as subscribed to this WhatsApp account yet. Incoming messages will not reach this inbox until it does.',
      });
    }

    return { confirmed, warnings };
  } catch (error) {
    logger.warn('meta.onboarding.subscription_read_failed', {
      wabaId: params.wabaId,
      error: error instanceof Error ? error.message : String(error),
    });
    warnings.push({
      code: 'subscription_unconfirmed',
      message:
        'We could not confirm with Meta that incoming messages are routed to ConvoNexa for this account.',
    });
    return { confirmed: false, warnings };
  }
}

/**
 * Puts the number on Cloud API so it can send.
 *
 * Two deliberate abstentions. A number Meta already reports as `CLOUD_API` is left alone,
 * because `register` is capped at ten calls per number per 72 hours and spending one to
 * learn what we were just told is how a reconnect locks a business out. And a number whose
 * code verification has not completed cannot be registered at all, so we say that instead
 * of firing a call that will certainly fail.
 */
async function registerNumber(
  graph: MetaGraphClient,
  params: { phone: MetaPhoneNumberSummary; accessToken: string },
): Promise<{ registered: boolean; pinToStore: string | null; warnings: ConnectionWarning[] }> {
  const warnings: ConnectionWarning[] = [];

  if (params.phone.platformType === 'CLOUD_API') {
    return { registered: true, pinToStore: null, warnings };
  }

  if (
    params.phone.codeVerificationStatus &&
    params.phone.codeVerificationStatus !== 'VERIFIED' &&
    params.phone.codeVerificationStatus !== 'EXPIRED'
  ) {
    warnings.push({
      code: 'registration_skipped_unverified',
      message:
        'This number has not finished phone verification with Meta, so it cannot send messages yet. Complete verification in WhatsApp Manager.',
    });
    return { registered: false, pinToStore: null, warnings };
  }

  const registrationPin = pin();

  try {
    const outcome = await graph.registerPhoneNumber({
      phoneNumberId: params.phone.id,
      accessToken: params.accessToken,
      pin: registrationPin,
    });
    // An already-registered number kept its original PIN; ours would be a lie on the row.
    return {
      registered: true,
      pinToStore: outcome.alreadyRegistered ? null : registrationPin,
      warnings,
    };
  } catch (error) {
    logger.warn('meta.onboarding.register_failed', {
      phoneNumberId: params.phone.id,
      error: error instanceof Error ? error.message : String(error),
    });
    warnings.push({
      code: 'registration_failed',
      message:
        'Meta would not register this number for sending. You can still receive messages, but replies will fail until this is resolved.',
    });
    return { registered: false, pinToStore: null, warnings };
  }
}

/**
 * Runs the whole pipeline and persists the result.
 *
 * Authorization is checked here rather than in the callers, so the Embedded Signup action,
 * the manual form and any future entry point cannot disagree about who may connect a number.
 */
export async function establishMetaConnection(
  ctx: TenantContext,
  params: EstablishConnectionParams,
): Promise<MetaConnectionResult> {
  requirePermission(ctx, 'whatsapp:connect');

  const workspaceId = ctx.workspaceId;
  const isMock = params.forceMock ?? isWhatsAppMocked;
  const graph = params.graph ?? metaGraphClient;
  const method: MetaConnectionMethod = isMock ? 'MOCK' : params.method;

  await emitConnectionStarted(prisma, { workspaceId, method });

  const warnings: ConnectionWarning[] = [];
  let stage: ConnectionStage = 'asset_verification';

  try {
    // Mock mode does no Graph calls at all, so a developer without Meta credentials still
    // gets a connection that behaves like one — labelled, never pretending to be live.
    const verified = isMock
      ? {
          waba: null,
          phone: {
            id: params.claimedPhoneNumberId,
            displayPhoneNumber: params.fallbackDisplayPhoneNumber ?? params.claimedPhoneNumberId,
            verifiedName: params.preferredDisplayName ?? null,
            qualityRating: 'GREEN',
            codeVerificationStatus: 'VERIFIED',
            platformType: 'CLOUD_API',
            throughputLevel: 'STANDARD',
          } satisfies MetaPhoneNumberSummary,
        }
      : await verifyAssets(graph, {
          accessToken: params.accessToken,
          wabaId: params.claimedWabaId,
          phoneNumberId: params.claimedPhoneNumberId,
        });

    const tokenFacts = isMock
      ? { expiresAt: null, warnings: [] as ConnectionWarning[] }
      : await introspectToken(graph, params.accessToken);
    warnings.push(...tokenFacts.warnings);

    const { isUpdate } = await assertAssetsUnclaimed(workspaceId, {
      wabaId: params.claimedWabaId,
      phoneNumberId: verified.phone.id,
    });
    if (!isUpdate) {
      await assertWithinPlanLimit(ctx, 'whatsappNumbers', 1);
    }

    stage = 'subscription';
    const subscription = isMock
      ? { confirmed: true, warnings: [] as ConnectionWarning[] }
      : await subscribeAndConfirm(graph, {
          wabaId: params.claimedWabaId,
          accessToken: params.accessToken,
        });
    warnings.push(...subscription.warnings);

    stage = 'registration';
    const registration = isMock
      ? { registered: true, pinToStore: null, warnings: [] as ConnectionWarning[] }
      : await registerNumber(graph, {
          phone: verified.phone,
          accessToken: params.accessToken,
        });
    warnings.push(...registration.warnings);

    // A connection is only CONNECTED when both halves of the loop are proven: Meta will
    // deliver to us, and the number can send. Anything less is DEGRADED with a reason.
    const status: ChannelStatus =
      subscription.confirmed && registration.registered ? 'CONNECTED' : 'DEGRADED';
    const blocking = warnings.find(
      (warning) =>
        warning.code === 'subscription_failed' ||
        warning.code === 'subscription_unconfirmed' ||
        warning.code === 'registration_failed' ||
        warning.code === 'registration_skipped_unverified',
    );

    stage = 'persistence';
    const account = await upsertWhatsAppAccountWithPhoneNumber(prisma, workspaceId, {
      wabaId: params.claimedWabaId,
      metaBusinessId: verified.waba?.ownerBusinessId ?? null,
      displayName:
        params.preferredDisplayName ?? verified.waba?.name ?? verified.phone.verifiedName ?? null,
      accessTokenEncrypted: encryptSecret(params.accessToken, env.AUTH_SECRET),
      tokenType: params.tokenType,
      tokenExpiresAt: params.tokenExpiresAt ?? tokenFacts.expiresAt,
      connectionMethod: method,
      status,
      isMock,
      phoneNumberId: verified.phone.id,
      displayPhoneNumber: verified.phone.displayPhoneNumber,
      verifiedName: verified.phone.verifiedName,
      qualityRating: verified.phone.qualityRating,
      codeVerificationStatus: verified.phone.codeVerificationStatus,
      platformType: verified.phone.platformType,
      throughputLevel: verified.phone.throughputLevel,
      isDefault: true,
    });

    const now = new Date();
    await updateAccountConnectionState(prisma, workspaceId, account.id, {
      subscribedAt: subscription.confirmed ? now : null,
      subscriptionVerifiedAt: subscription.confirmed ? now : null,
      lastHealthCheckAt: now,
      // The upsert cleared the previous error; re-state the current one so a DEGRADED
      // account always carries the sentence explaining why.
      lastErrorCode: blocking?.code ?? null,
      lastErrorMessage: blocking?.message ?? null,
      lastErrorAt: blocking ? now : null,
    });

    const persistedPhone = account.phoneNumbers.find(
      (entry) => entry.phoneNumberId === verified.phone.id,
    );
    if (persistedPhone && registration.registered) {
      await markPhoneNumberRegistered(prisma, workspaceId, persistedPhone.id, {
        // Undefined leaves the column alone: a number that was already on Cloud API kept
        // its original PIN, and ours is not it.
        registrationPinEncrypted: registration.pinToStore
          ? encryptSecret(registration.pinToStore, env.AUTH_SECRET)
          : undefined,
        at: now,
      });
    }

    await appendAuditLog(prisma, {
      action: isUpdate ? 'whatsapp.account.updated' : 'whatsapp.account.connected',
      workspaceId,
      actorUserId: ctx.user.id,
      actorMemberId: ctx.membershipId,
      actorType: 'USER',
      resourceType: 'WhatsAppAccount',
      resourceId: account.id,
      metadata: {
        method,
        wabaId: params.claimedWabaId,
        phoneNumberId: verified.phone.id,
        displayPhoneNumber: verified.phone.displayPhoneNumber,
        status,
        subscriptionConfirmed: subscription.confirmed,
        registered: registration.registered,
        isMock,
        warnings: warnings.map((warning) => warning.code),
      },
    });

    await emitConnectionSucceeded(prisma, {
      workspaceId,
      method,
      wabaId: params.claimedWabaId,
      phoneNumberId: verified.phone.id,
      subscribed: subscription.confirmed,
      registered: registration.registered,
    });

    return {
      accountId: account.id,
      wabaId: params.claimedWabaId,
      phoneNumberId: verified.phone.id,
      displayPhoneNumber: verified.phone.displayPhoneNumber,
      status,
      subscriptionConfirmed: subscription.confirmed,
      registered: registration.registered,
      warnings,
      account,
    };
  } catch (error) {
    await emitConnectionFailed(prisma, {
      workspaceId,
      method,
      stage,
      errorCode: error instanceof Error ? error.constructor.name : 'UnknownError',
    });
    throw connectionError(stage, error);
  }
}

/**
 * Turns an Embedded Signup authorization code into a connected number.
 *
 * The code is exchanged here, on the server, with the app secret — never in the browser,
 * and never echoed back in a response. Meta's code lives about 30 seconds, so this runs
 * inline on the callback rather than through the job queue.
 */
export async function completeEmbeddedSignup(
  ctx: TenantContext,
  params: {
    code: string;
    wabaId: string;
    phoneNumberId: string;
    graph?: MetaGraphClient;
  },
): Promise<MetaConnectionResult> {
  requirePermission(ctx, 'whatsapp:connect');

  if (!isEmbeddedSignupConfigured) {
    throw new ValidationError(
      'Connecting through Meta is not configured on this deployment. Use an access token instead.',
    );
  }

  const graph = params.graph ?? metaGraphClient;

  let exchange: Awaited<ReturnType<MetaGraphClient['exchangeCodeForToken']>>;
  try {
    exchange = await graph.exchangeCodeForToken({
      code: params.code,
      redirectUri: env.META_OAUTH_REDIRECT_URI,
    });
  } catch (error) {
    await emitConnectionFailed(prisma, {
      workspaceId: ctx.workspaceId,
      method: 'EMBEDDED_SIGNUP',
      stage: 'token_exchange',
      errorCode: error instanceof Error ? error.constructor.name : 'UnknownError',
    });
    throw connectionError('token_exchange', error);
  }

  return establishMetaConnection(ctx, {
    method: 'EMBEDDED_SIGNUP',
    accessToken: exchange.accessToken,
    // Meta calls this a business integration system user token; it is scoped to the assets
    // the business granted during signup, which is why it needs no further narrowing.
    tokenType: 'BUSINESS_INTEGRATION',
    tokenExpiresAt: exchange.expiresAt,
    claimedWabaId: params.wabaId,
    claimedPhoneNumberId: params.phoneNumberId,
    graph: params.graph,
  });
}
