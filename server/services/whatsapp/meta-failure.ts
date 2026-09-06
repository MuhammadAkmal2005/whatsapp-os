/**
 * What we know about a failed call to Meta.
 *
 * Shared by both Meta adapters — the management client and the messaging provider —
 * because they have to agree on one question: could the request bytes already have
 * reached Meta? Two adapters answering that differently is how a customer receives the
 * same reply twice.
 *
 * Deliberately free of domain and HTTP imports so the send-path classifier can be
 * tested without a database or a network.
 */

/**
 * Everything a caller may need to classify a Meta failure, and nothing a caller
 * could accidentally log a secret from.
 */
export type MetaGraphFailure = {
  kind: 'http' | 'transport' | 'malformed';
  status: number | null;
  metaCode: number | null;
  metaSubcode: number | null;
  /**
   * Whether the request bytes could already have reached Meta. False only when the
   * connection provably never opened — a refused socket, a DNS failure, a TLS
   * rejection. This is the single fact that decides whether a retry is safe.
   */
  requestPossiblySent: boolean;
  /** Node's error code for a transport failure (`ECONNREFUSED`, `ETIMEDOUT`, …). */
  transportCode: string | null;
};

/**
 * Node/undici codes that prove the request never left this process.
 *
 * Everything absent from this set is treated as "might have been sent", including
 * codes we have never seen. The default has to be the cautious one: a wrong guess in
 * this direction wastes an operator's attention, and a wrong guess in the other
 * direction sends a real customer a duplicate message.
 */
const NEVER_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
]);

/** True when the code proves the connection never opened. Unknown codes are false. */
export function isNeverSentTransportCode(code: string | null): boolean {
  if (code === null) return false;
  return NEVER_SENT_CODES.has(code);
}

export function isMetaGraphFailure(value: unknown): value is MetaGraphFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requestPossiblySent' in value &&
    typeof (value as MetaGraphFailure).requestPossiblySent === 'boolean'
  );
}

/**
 * Walks an error's `cause` chain looking for a Node error code.
 *
 * `fetch` wraps transport problems in a bare `TypeError: fetch failed` and hides the
 * useful part underneath, sometimes two levels down (`AggregateError` from a
 * multi-address connect attempt). Reading only the top-level error would classify
 * every transport failure as "unknown", which is the reading that forces a human to
 * check a WhatsApp thread by hand.
 */
export function extractTransportCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== 'object') return null;
    const candidate = current as {
      code?: unknown;
      name?: unknown;
      errors?: unknown;
      cause?: unknown;
    };

    if (typeof candidate.code === 'string') return candidate.code;
    if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') return 'ABORT_ERR';

    if (Array.isArray(candidate.errors) && candidate.errors.length > 0) {
      const nested = extractTransportCode(candidate.errors[0]);
      if (nested) return nested;
    }

    current = candidate.cause;
  }
  return null;
}

/**
 * Builds the failure record for a thrown transport error.
 *
 * One function so the two adapters cannot drift: a timeout must mean the same thing on
 * the messaging path as it does on the management path.
 */
export function transportFailure(error: unknown): MetaGraphFailure {
  const transportCode = extractTransportCode(error);
  return {
    kind: 'transport',
    status: null,
    metaCode: null,
    metaSubcode: null,
    requestPossiblySent: !isNeverSentTransportCode(transportCode),
    transportCode,
  };
}
