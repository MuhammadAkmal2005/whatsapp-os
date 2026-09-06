/**
 * Recording what a send attempt did, once the attempt itself is over.
 *
 * Split from the dispatch service because these are two different jobs: deciding whether
 * and how to send is one, and telling the truth afterwards is the other. The second is
 * where the duplicate-message bugs live, so it is worth reading on its own.
 *
 * Every function here treats "the message row is wrong" as the failure to avoid, not
 * "the write threw". A send that reached Meta and then lost its database write is the
 * most dangerous state this system can be in, because the row it leaves behind looks
 * exactly like a send that never happened.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import {
  markDeliveryUncertain,
  recordMessageDispatch,
  updateMessageStatus,
  type MessageWithDetailsRow,
} from '@/server/repositories/message.repository';
import {
  findPhoneNumberById,
  touchOutboundSuccess,
  updateAccountError,
} from '@/server/repositories/whatsapp-account.repository';
import { emitMessageFailed, emitMessageSent } from '@/server/telemetry/meta-events';
import type { ProviderSendResult } from './provider.interface';
import { indicatesCredentialFailure, type SendFailure } from './send-failure';

/**
 * How many times we try to write down a message id Meta has already given us.
 *
 * This retry is not politeness towards the database — it is the only thing standing
 * between a dropped connection and a customer receiving the same message twice. The
 * message is already gone; if the id never lands, nothing downstream can correlate
 * Meta's delivery callback to this row, and the queue would re-send a message that
 * looks unsent. Three quick attempts clear the transient cases (a pool blip, a
 * serialization conflict) that make up nearly all of them.
 */
const PERSIST_ATTEMPTS = 3;
const PERSIST_RETRY_DELAY_MS = 250;

/**
 * The failure recorded when the send worked and only the bookkeeping failed.
 *
 * Classified `UNCERTAIN` because that is the classification the retry gate reads, and
 * stopping the retry is the point. The code names the real fault so nobody reading the
 * row later concludes Meta rejected anything.
 */
const PERSIST_FAILURE: SendFailure = {
  classification: 'UNCERTAIN',
  errorCode: 'DISPATCH_PERSIST_FAILED',
  errorMessage:
    'The message reached WhatsApp but we could not record it. It will not be sent again automatically — check the thread before resending.',
  retryAfterSeconds: null,
  retryable: false,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes the provider id for a send that has already happened, and refuses to leave the
 * row re-sendable if it cannot.
 *
 * Throws when every attempt fails, because a caller told "sent" about a row that does
 * not say so would be a quiet lie — but only after flagging the row, so the throw causes
 * a retry that short-circuits instead of a retry that sends.
 */
export async function persistDispatchResult(
  workspaceId: string,
  message: MessageWithDetailsRow,
  phoneNumberId: string | null,
  sendResult: ProviderSendResult,
): Promise<MessageWithDetailsRow | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt += 1) {
    try {
      return await recordMessageDispatch(prisma, workspaceId, message.id, {
        providerMessageId: sendResult.providerMessageId,
        status: sendResult.status,
        sentAt: sendResult.occurredAt,
      });
    } catch (error) {
      lastError = error;
      if (attempt < PERSIST_ATTEMPTS) {
        await sleep(PERSIST_RETRY_DELAY_MS * attempt);
      }
    }
  }

  // The provider id goes in the log because it is now the only handle a human has for
  // matching this row to the message sitting in the customer's WhatsApp.
  logger.error('whatsapp.outbound.dispatch_persist_failed', {
    workspaceId,
    messageId: message.id,
    providerMessageId: sendResult.providerMessageId,
    error: String(lastError),
  });

  await recordSendFailure(workspaceId, message, phoneNumberId, PERSIST_FAILURE);

  throw lastError;
}

/**
 * Persists the outcome of a failed send according to what we actually know.
 *
 * The distinction between the two branches is the whole reason the classifier exists.
 * The old code marked every failure FAILED, which reads as "this did not reach the
 * customer" — a claim we cannot make after a timeout, and one that invited the retry
 * that sends the message twice.
 */
export async function recordSendFailure(
  workspaceId: string,
  message: MessageWithDetailsRow,
  phoneNumberId: string | null,
  failure: SendFailure,
): Promise<void> {
  if (failure.classification === 'UNCERTAIN') {
    await markDeliveryUncertain(prisma, workspaceId, message.id, {
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
    });
  } else {
    await updateMessageStatus(prisma, workspaceId, message.id, 'FAILED', {
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
    });
  }

  logger.warn('whatsapp.outbound.send_failed', {
    workspaceId,
    messageId: message.id,
    classification: failure.classification,
    errorCode: failure.errorCode,
    retryable: failure.retryable,
  });

  await emitMessageFailed(prisma, {
    workspaceId,
    messageType: message.type,
    errorCode: failure.errorCode,
    classification: failure.classification,
  }).catch((error: unknown) => {
    // Telemetry must never be the reason a send outcome goes unrecorded.
    logger.error('whatsapp.outbound.telemetry_failed', { workspaceId, error: String(error) });
  });

  if (!phoneNumberId || !indicatesCredentialFailure(failure)) return;

  // Meta refused our credentials for this number. That is a channel-level fact, and the
  // owner has to reconnect before anything else will go out.
  try {
    const phoneRecord = await findPhoneNumberById(prisma, workspaceId, phoneNumberId);
    if (phoneRecord) {
      await updateAccountError(prisma, workspaceId, phoneRecord.accountId, {
        lastErrorMessage: failure.errorMessage,
      });
    }
  } catch (error) {
    // A secondary failure here must not mask the send failure the caller is handling.
    logger.error('whatsapp.outbound.account_error_write_failed', {
      workspaceId,
      messageId: message.id,
      error: String(error),
    });
  }
}

/**
 * Records the two facts a successful send produces beyond the message row itself.
 *
 * `lastOutboundSuccessAt` is the half of connection health that Meta cannot tell us: a
 * token that just sent a message is a token that works, whatever a status column says.
 * Neither write is allowed to fail the dispatch — the message is already delivered, and
 * throwing here would report a successful send as an error and invite a retry.
 */
export async function recordSendSuccess(
  workspaceId: string,
  messageType: string,
  phoneNumberId: string | null,
  sendResult: ProviderSendResult,
): Promise<void> {
  if (phoneNumberId) {
    try {
      const phoneRecord = await findPhoneNumberById(prisma, workspaceId, phoneNumberId);
      if (phoneRecord) {
        await touchOutboundSuccess(prisma, workspaceId, {
          accountId: phoneRecord.accountId,
          phoneNumberRowId: phoneRecord.id,
          at: sendResult.occurredAt,
        });
      }
    } catch (error) {
      logger.error('whatsapp.outbound.activity_write_failed', {
        workspaceId,
        error: String(error),
      });
    }
  }

  await emitMessageSent(prisma, { workspaceId, messageType }).catch((error: unknown) => {
    logger.error('whatsapp.outbound.telemetry_failed', { workspaceId, error: String(error) });
  });
}
