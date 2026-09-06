/**
 * What to do about a send that did not come back with a message id.
 *
 * The distinction this file exists to make is not "did it work" but "do we know". Meta's
 * `/messages` endpoint has no idempotency key: if we send a request and never learn the
 * outcome, there is no way to ask "did you already accept this one?" and no way to make
 * a second attempt safe. So the three answers are:
 *
 *  - `NOT_SENT_RETRYABLE` — the request provably never left this process, or Meta
 *    refused to look at it. Nothing reached the customer, so retrying is free.
 *  - `NOT_SENT_PERMANENT` — Meta looked at the request and rejected it. An identical
 *    retry earns an identical rejection; something has to change first.
 *  - `UNCERTAIN` — the request may have been accepted and the answer lost. Retrying
 *    risks sending a real customer the same message twice.
 *
 * `UNCERTAIN` is the default for anything unrecognised, and that asymmetry is the whole
 * point. A wrongly-uncertain message costs an operator a glance at a thread. A wrongly
 * retried message is a duplicate in a stranger's WhatsApp that we cannot recall.
 */

import 'server-only';

import {
  BusinessRuleError,
  isAppError,
  NotConfiguredError,
  RateLimitError,
  ValidationError,
} from '@/server/errors';
import { isMetaGraphFailure } from './meta-failure';

export type SendFailureClass = 'NOT_SENT_RETRYABLE' | 'NOT_SENT_PERMANENT' | 'UNCERTAIN';

export type SendFailure = {
  classification: SendFailureClass;
  /** Stable machine code, safe to store and show. Never carries provider text. */
  errorCode: string;
  /** Operator-facing sentence. Already free of credentials by the adapters' redaction. */
  errorMessage: string;
  /** Present only for a rate limit, where Meta told us how long to wait. */
  retryAfterSeconds: number | null;
  /** Whether the queue should try this message again. */
  retryable: boolean;
};

/** Meta error codes that mean the credentials, not the message, are the problem. */
const AUTH_META_CODES = new Set([190, 10]);

/**
 * Whether this failure means the number's connection needs an owner's attention.
 *
 * Only credential rejections qualify. A rejected recipient or a closed service window
 * is a per-message problem, and flagging the whole channel for it would train the owner
 * to ignore the flag.
 */
export function indicatesCredentialFailure(failure: SendFailure): boolean {
  return failure.errorCode === 'META_CREDENTIALS_REJECTED';
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}

export function classifySendFailure(error: unknown): SendFailure {
  // Meta throttled us. A throttled request is refused before it is processed, so
  // nothing reached the customer and the only correct response is to wait.
  if (error instanceof RateLimitError) {
    return {
      classification: 'NOT_SENT_RETRYABLE',
      errorCode: 'META_RATE_LIMITED',
      errorMessage: messageOf(error, 'Meta rate limit reached.'),
      retryAfterSeconds: error.retryAfterSeconds,
      retryable: true,
    };
  }

  // Outside the 24-hour service window, or another domain rule. Retrying sends the
  // same disallowed request; the fix is an approved template.
  if (error instanceof BusinessRuleError) {
    return {
      classification: 'NOT_SENT_PERMANENT',
      errorCode: 'BUSINESS_RULE_VIOLATION',
      errorMessage: messageOf(error, 'This message is not allowed right now.'),
      retryAfterSeconds: null,
      retryable: false,
    };
  }

  // Meta rejected the shape of the request — a malformed recipient, an unknown
  // template, a parameter it does not accept.
  if (error instanceof ValidationError) {
    return {
      classification: 'NOT_SENT_PERMANENT',
      errorCode: 'META_REJECTED_REQUEST',
      errorMessage: messageOf(error, 'Meta rejected this message.'),
      retryAfterSeconds: null,
      retryable: false,
    };
  }

  // The number is not connected. Nothing was attempted.
  if (error instanceof NotConfiguredError) {
    return {
      classification: 'NOT_SENT_PERMANENT',
      errorCode: 'NOT_CONNECTED',
      errorMessage: messageOf(error, 'This WhatsApp number is not connected.'),
      retryAfterSeconds: null,
      retryable: false,
    };
  }

  const failure = isAppError(error) && isMetaGraphFailure(error.cause) ? error.cause : null;

  if (failure) {
    if (failure.kind === 'transport') {
      // The one case we can be sure about: the socket never opened.
      if (!failure.requestPossiblySent) {
        return {
          classification: 'NOT_SENT_RETRYABLE',
          errorCode: `TRANSPORT_${failure.transportCode ?? 'UNREACHABLE'}`,
          errorMessage: `Could not reach Meta (${failure.transportCode ?? 'network error'}). Nothing was sent.`,
          retryAfterSeconds: null,
          retryable: true,
        };
      }

      // A read timeout or a reset mid-flight. Meta may have the message.
      return {
        classification: 'UNCERTAIN',
        errorCode: `TRANSPORT_${failure.transportCode ?? 'UNKNOWN'}`,
        errorMessage: `The connection to Meta broke after the message was sent (${
          failure.transportCode ?? 'network error'
        }). We cannot tell whether it was delivered.`,
        retryAfterSeconds: null,
        retryable: false,
      };
    }

    if (failure.kind === 'http') {
      if (AUTH_META_CODES.has(failure.metaCode ?? -1) || failure.status === 401 || failure.status === 403) {
        return {
          classification: 'NOT_SENT_PERMANENT',
          errorCode: 'META_CREDENTIALS_REJECTED',
          errorMessage: 'Meta rejected our access to this number. Reconnect it in Settings.',
          retryAfterSeconds: null,
          retryable: false,
        };
      }

      // 5xx: Meta received the bytes. Whether it queued the message is exactly what
      // its own error does not say, and there is no id to check against.
      if ((failure.status ?? 0) >= 500) {
        return {
          classification: 'UNCERTAIN',
          errorCode: `META_HTTP_${failure.status}`,
          errorMessage: `Meta returned an error after receiving the message (HTTP ${failure.status}). We cannot tell whether it was delivered.`,
          retryAfterSeconds: null,
          retryable: false,
        };
      }

      // Any other 4xx is a considered refusal.
      return {
        classification: 'NOT_SENT_PERMANENT',
        errorCode: failure.metaCode ? `META_${failure.metaCode}` : `META_HTTP_${failure.status}`,
        errorMessage: messageOf(error, 'Meta refused this message.'),
        retryAfterSeconds: null,
        retryable: false,
      };
    }

    // A 2xx we could not parse. Meta answered successfully and we lost the id, which
    // is the most likely-delivered of all the uncertain cases.
    return {
      classification: 'UNCERTAIN',
      errorCode: 'META_UNREADABLE_RESPONSE',
      errorMessage: 'Meta accepted the request but returned a response we could not read.',
      retryAfterSeconds: null,
      retryable: false,
    };
  }

  // An untyped throw, or a provider error carrying no failure record. We do not know
  // where in the exchange it happened, so we do not claim to.
  return {
    classification: 'UNCERTAIN',
    errorCode: isAppError(error) ? error.code : 'DISPATCH_ERROR',
    errorMessage: messageOf(error, 'The send failed for an unrecognised reason.'),
    retryAfterSeconds: null,
    retryable: false,
  };
}
