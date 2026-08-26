/**
 * The error taxonomy.
 *
 * Two audiences, and they get different information. A user sees a stable code
 * and a sentence they can act on. An operator gets the cause, the stack, and a
 * request id, in the log only. Nothing internal crosses to the response.
 *
 * Dependency-free so services and pure tests can both use it.
 */

export type ErrorDetails = Record<string, string[]>;

export abstract class AppError extends Error {
  /** Stable machine-readable code. Clients may branch on it, so renaming one is
   *  a breaking change. */
  abstract readonly code: string;
  abstract readonly status: number;

  /** Field-level problems, safe to render next to form inputs. */
  readonly details?: ErrorDetails;

  /**
   * True when the message may be shown verbatim to a user. Subclasses that wrap
   * an internal failure set this false, and the handler substitutes a generic
   * sentence.
   */
  readonly expose: boolean = true;

  /** The underlying cause, for logs only. */
  override readonly cause?: unknown;

  constructor(message: string, options: { details?: ErrorDetails; cause?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    if (options.details) this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly status = 422;

  constructor(message = 'Please check the highlighted fields and try again.', details?: ErrorDetails) {
    super(message, details ? { details } : {});
  }
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = 401;

  constructor(message = 'Please sign in to continue.') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly status = 403;

  constructor(message = 'You do not have permission to do this.') {
    super(message);
  }
}

/**
 * Also the answer for "exists, but belongs to another workspace".
 *
 * Returning 403 there would confirm the id is real, letting an attacker
 * enumerate another tenant's records by watching which ids give 403 and which
 * give 404. Indistinguishability matters more than precision.
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor(resource = 'Resource') {
    super(`${resource} not found.`);
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT';
  readonly status = 409;
}

/** A domain rule was violated — overselling stock, refunding a refund. Distinct
 *  from ValidationError, which is about the shape of the input rather than its
 *  consequences. */
export class BusinessRuleError extends AppError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
  readonly status = 400;
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED';
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = 'Too many attempts. Please wait a moment and try again.') {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A plan limit was reached. Deliberately its own type so the UI can offer an
 *  upgrade rather than an apology. */
export class LimitExceededError extends AppError {
  readonly code = 'PLAN_LIMIT_EXCEEDED';
  readonly status = 402;
  readonly limitName: string;
  readonly limit: number;

  constructor(limitName: string, limit: number, message?: string) {
    super(message ?? `You have reached your plan limit for ${limitName}. Upgrade to continue.`);
    this.limitName = limitName;
    this.limit = limit;
  }
}

/** The action needs an integration that has not been set up. Not a bug, and not
 *  something to hide behind "coming soon" — the UI should say what to connect. */
export class NotConfiguredError extends AppError {
  readonly code = 'NOT_CONFIGURED';
  readonly status = 409;

  constructor(what: string, message?: string) {
    super(message ?? `${what} is not connected yet. Connect it in Settings to use this.`);
  }
}

/** An external provider failed. The provider's own message is kept for the log
 *  but never exposed — it may contain credentials or internal identifiers. */
export class ProviderError extends AppError {
  readonly code = 'PROVIDER_ERROR';
  readonly status = 502;
  override readonly expose = false;
  readonly provider: string;

  constructor(provider: string, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : {});
    this.provider = provider;
  }
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR';
  readonly status = 500;
  override readonly expose = false;

  constructor(message = 'Unexpected internal error', cause?: unknown) {
    super(message, cause !== undefined ? { cause } : {});
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** The sentence shown when an error must not be exposed. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Reduces any thrown value to the safe triple that may leave the server.
 * `toResponse` in the route layer calls this; nothing else should need to.
 */
export function toSafeError(error: unknown): {
  code: string;
  status: number;
  message: string;
  details?: ErrorDetails;
} {
  if (isAppError(error)) {
    const base = {
      code: error.code,
      status: error.status,
      message: error.expose ? error.message : GENERIC_ERROR_MESSAGE,
    };
    return error.details ? { ...base, details: error.details } : base;
  }

  // An unknown throw is a bug. Say nothing about it publicly.
  return { code: 'INTERNAL_ERROR', status: 500, message: GENERIC_ERROR_MESSAGE };
}
