/**
 * Non-secret facts derived from the configured database endpoint.
 *
 * Kept separate from `db/connection.ts` because this is pure string handling and
 * has no business dragging the Prisma client into its module graph — which is what
 * makes it directly unit-testable.
 *
 * Why it exists at all: whether the runtime talks to Neon's pooler, and whether
 * Prisma's pooling parameters are set, decides both connection-count behaviour and
 * how wide a `Promise.all` can actually run. Neither can be read from the
 * repository, because the live value lives in the host's environment. Reporting the
 * derived booleans lets that be answered from production without exposing the
 * string.
 *
 * Nothing here can carry a credential: no host, no user, no password, no database
 * name is ever returned.
 */

import { env } from '@/config/env';

export type ConnectionConfigFacts = {
  /** Neon's PgBouncer endpoint (host contains `-pooler`). */
  readonly pooled: boolean;
  /** Prisma's `pgbouncer=true`, which disables prepared-statement caching. */
  readonly pgbouncerFlag: boolean;
  /** Explicit `connection_limit`, or null when left to Prisma's default. */
  readonly connectionLimit: number | null;
  /** Prisma's default pool size is `cpus * 2 + 1`; this reports the multiplier input. */
  readonly cpuCount: number;
  readonly sslMode: string | null;
};

/** The env-bound reading, for the health endpoint. */
export function connectionConfigFacts(cpuCount: number): ConnectionConfigFacts {
  return deriveConnectionFacts(env.DATABASE_URL, cpuCount);
}

/**
 * The pure derivation, separated so it can be tested against fictional URLs — the
 * wrapper above can only ever see one value per process.
 */
export function deriveConnectionFacts(
  databaseUrl: string,
  cpuCount: number,
): ConnectionConfigFacts {
  const fallback: ConnectionConfigFacts = {
    pooled: false,
    pgbouncerFlag: false,
    connectionLimit: null,
    cpuCount,
    sslMode: null,
  };

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // An unparseable URL is Prisma's problem to report, not this probe's problem to
    // crash on. Reporting "nothing configured" is honest and keeps the endpoint up.
    return fallback;
  }

  const rawLimit = url.searchParams.get('connection_limit');
  const parsedLimit = rawLimit === null ? Number.NaN : Number.parseInt(rawLimit, 10);

  return {
    pooled: url.hostname.includes('-pooler'),
    pgbouncerFlag: url.searchParams.get('pgbouncer') === 'true',
    connectionLimit: Number.isFinite(parsedLimit) ? parsedLimit : null,
    cpuCount,
    sslMode: url.searchParams.get('sslmode'),
  };
}
