/**
 * The classifier decides whether a failed send may be retried. Getting it wrong in one
 * direction wastes an operator's attention; getting it wrong in the other sends a real
 * customer a duplicate message. These tests are written from that asymmetry: every case
 * asserts the classification *and* the retryable flag, because it is the pair that
 * determines what the queue does next.
 */

import { describe, expect, it } from 'vitest';

import {
  BusinessRuleError,
  NotConfiguredError,
  ProviderError,
  RateLimitError,
  ValidationError,
} from '@/server/errors';
import type { MetaGraphFailure } from '@/server/services/whatsapp/meta-failure';
import {
  classifySendFailure,
  indicatesCredentialFailure,
} from '@/server/services/whatsapp/send-failure';

function failure(overrides: Partial<MetaGraphFailure>): MetaGraphFailure {
  return {
    kind: 'http',
    status: null,
    metaCode: null,
    metaSubcode: null,
    requestPossiblySent: false,
    transportCode: null,
    ...overrides,
  };
}

function providerErrorWith(cause: MetaGraphFailure, message = 'Meta call failed'): ProviderError {
  return new ProviderError('whatsapp', message, cause);
}

describe('classifySendFailure', () => {
  describe('nothing reached the customer, and retrying is free', () => {
    it('treats a rate limit as not sent and carries Meta’s own wait', () => {
      const result = classifySendFailure(new RateLimitError(45, 'Slow down'));

      expect(result.classification).toBe('NOT_SENT_RETRYABLE');
      expect(result.errorCode).toBe('META_RATE_LIMITED');
      expect(result.retryable).toBe(true);
      expect(result.retryAfterSeconds).toBe(45);
    });

    it('treats a refused connection as provably never sent', () => {
      const result = classifySendFailure(
        providerErrorWith(
          failure({ kind: 'transport', requestPossiblySent: false, transportCode: 'ECONNREFUSED' }),
        ),
      );

      expect(result.classification).toBe('NOT_SENT_RETRYABLE');
      expect(result.errorCode).toBe('TRANSPORT_ECONNREFUSED');
      expect(result.retryable).toBe(true);
    });

    it('treats a DNS failure as provably never sent', () => {
      const result = classifySendFailure(
        providerErrorWith(
          failure({ kind: 'transport', requestPossiblySent: false, transportCode: 'ENOTFOUND' }),
        ),
      );

      expect(result.classification).toBe('NOT_SENT_RETRYABLE');
      expect(result.retryable).toBe(true);
    });
  });

  describe('Meta looked at the request and said no', () => {
    it('classifies a closed service window as permanent', () => {
      const result = classifySendFailure(
        new BusinessRuleError('Cannot send outside the 24-hour window.'),
      );

      expect(result.classification).toBe('NOT_SENT_PERMANENT');
      expect(result.errorCode).toBe('BUSINESS_RULE_VIOLATION');
      expect(result.retryable).toBe(false);
    });

    it('classifies a rejected request shape as permanent', () => {
      const result = classifySendFailure(new ValidationError('Bad recipient'));

      expect(result.classification).toBe('NOT_SENT_PERMANENT');
      expect(result.errorCode).toBe('META_REJECTED_REQUEST');
      expect(result.retryable).toBe(false);
    });

    it('classifies an unconnected number as permanent', () => {
      const result = classifySendFailure(new NotConfiguredError('WhatsApp'));

      expect(result.classification).toBe('NOT_SENT_PERMANENT');
      expect(result.errorCode).toBe('NOT_CONNECTED');
      expect(result.retryable).toBe(false);
    });

    it('classifies a credential rejection as permanent, not as a retryable transport case', () => {
      // The trap this guards: the graph adapter sets `requestPossiblySent: false` on every
      // status below 500, so a naive read of that flag alone would retry a 401 forever.
      const result = classifySendFailure(
        providerErrorWith(failure({ status: 401, metaCode: 190, requestPossiblySent: false })),
      );

      expect(result.classification).toBe('NOT_SENT_PERMANENT');
      expect(result.errorCode).toBe('META_CREDENTIALS_REJECTED');
      expect(result.retryable).toBe(false);
      expect(indicatesCredentialFailure(result)).toBe(true);
    });

    it('classifies a 403 as a credential rejection even without a Meta code', () => {
      const result = classifySendFailure(
        providerErrorWith(failure({ status: 403, requestPossiblySent: false })),
      );

      expect(result.errorCode).toBe('META_CREDENTIALS_REJECTED');
      expect(indicatesCredentialFailure(result)).toBe(true);
    });

    it('classifies another 4xx as permanent and keeps Meta’s code in the machine code', () => {
      const result = classifySendFailure(
        providerErrorWith(failure({ status: 400, metaCode: 131_026 })),
      );

      expect(result.classification).toBe('NOT_SENT_PERMANENT');
      expect(result.errorCode).toBe('META_131026');
      expect(result.retryable).toBe(false);
      expect(indicatesCredentialFailure(result)).toBe(false);
    });
  });

  describe('the answer was lost, so no automated retry', () => {
    it('does not claim a timed-out send failed', () => {
      const result = classifySendFailure(
        providerErrorWith(
          failure({ kind: 'transport', requestPossiblySent: true, transportCode: 'ETIMEDOUT' }),
        ),
      );

      expect(result.classification).toBe('UNCERTAIN');
      expect(result.errorCode).toBe('TRANSPORT_ETIMEDOUT');
      expect(result.retryable).toBe(false);
    });

    it('does not claim an aborted send failed', () => {
      const result = classifySendFailure(
        providerErrorWith(
          failure({ kind: 'transport', requestPossiblySent: true, transportCode: 'ABORT_ERR' }),
        ),
      );

      expect(result.classification).toBe('UNCERTAIN');
      expect(result.retryable).toBe(false);
    });

    it('does not claim a connection reset mid-flight failed', () => {
      const result = classifySendFailure(
        providerErrorWith(
          failure({ kind: 'transport', requestPossiblySent: true, transportCode: 'ECONNRESET' }),
        ),
      );

      expect(result.classification).toBe('UNCERTAIN');
      expect(result.retryable).toBe(false);
    });

    it('treats a Meta 5xx as uncertain, because Meta received the bytes', () => {
      const result = classifySendFailure(
        providerErrorWith(failure({ status: 503, requestPossiblySent: true })),
      );

      expect(result.classification).toBe('UNCERTAIN');
      expect(result.errorCode).toBe('META_HTTP_503');
      expect(result.retryable).toBe(false);
    });

    it('treats an unreadable 2xx as uncertain — the likeliest-delivered case of all', () => {
      const result = classifySendFailure(
        providerErrorWith(failure({ kind: 'malformed', status: 200, requestPossiblySent: true })),
      );

      expect(result.classification).toBe('UNCERTAIN');
      expect(result.errorCode).toBe('META_UNREADABLE_RESPONSE');
      expect(result.retryable).toBe(false);
    });

    it('defaults an unrecognised throw to uncertain rather than guessing', () => {
      const result = classifySendFailure(new Error('something went sideways'));

      expect(result.classification).toBe('UNCERTAIN');
      expect(result.errorCode).toBe('DISPATCH_ERROR');
      expect(result.retryable).toBe(false);
    });

    it('defaults a provider error with no failure record to uncertain', () => {
      const result = classifySendFailure(new ProviderError('whatsapp', 'Unknown provider fault'));

      expect(result.classification).toBe('UNCERTAIN');
      expect(result.retryable).toBe(false);
    });

    it('defaults a non-Error throw to uncertain', () => {
      const result = classifySendFailure('a string was thrown');

      expect(result.classification).toBe('UNCERTAIN');
      expect(result.retryable).toBe(false);
    });
  });

  describe('no classification leaks provider text into the machine code', () => {
    const cases: readonly unknown[] = [
      new RateLimitError(30, 'wait'),
      new BusinessRuleError('window closed'),
      new ValidationError('bad param'),
      new NotConfiguredError('WhatsApp'),
      providerErrorWith(failure({ status: 500, requestPossiblySent: true })),
      providerErrorWith(failure({ kind: 'malformed', status: 200, requestPossiblySent: true })),
      new Error('raw'),
    ];

    it('keeps every error code to a stable uppercase identifier', () => {
      for (const error of cases) {
        const result = classifySendFailure(error);
        expect(result.errorCode).toMatch(/^[A-Z0-9_]+$/);
        expect(result.errorMessage.length).toBeGreaterThan(0);
      }
    });
  });
});
