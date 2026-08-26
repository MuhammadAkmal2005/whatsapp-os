/**
 * Structured logging.
 *
 * One tiny logger rather than a dependency, because the MVP's needs are a level,
 * a message, a request id to correlate a line with the error a user saw, and a
 * bag of fields — and because a log line must never throw. A logging call that
 * crashes the request it was describing is the worst possible failure mode, so
 * serialisation is guarded and falls back to a plain string.
 *
 * Output is line-delimited JSON in production, so a log drain can parse it, and a
 * terser human form in development. It deliberately does not read secrets or
 * format request bodies; callers pass only what is safe to persist, and personal
 * data such as phone numbers is masked before it arrives here.
 *
 * When an error-monitoring service is configured later, this is the one place
 * that forwards to it — the interface the rest of the code calls does not change.
 */

import { isProduction } from '@/config/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MIN_LEVEL: LogLevel = isProduction ? 'info' : 'debug';

function enabled(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[MIN_LEVEL];
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserialisable]"';
  }
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (!enabled(level)) return;

  const record = { level, time: new Date().toISOString(), message, ...fields };

  const line = isProduction
    ? safeStringify(record)
    : `${level.toUpperCase().padEnd(5)} ${message}${fields ? ` ${safeStringify(fields)}` : ''}`;

  // eslint-disable-next-line no-console -- the logger is the one place console is permitted
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
};

/** A child logger that stamps every line with the same fields — a request id,
 *  a workspace id — so related lines can be found together. */
export function withContext(base: LogFields) {
  return {
    debug: (message: string, fields?: LogFields) => emit('debug', message, { ...base, ...fields }),
    info: (message: string, fields?: LogFields) => emit('info', message, { ...base, ...fields }),
    warn: (message: string, fields?: LogFields) => emit('warn', message, { ...base, ...fields }),
    error: (message: string, fields?: LogFields) => emit('error', message, { ...base, ...fields }),
  };
}
