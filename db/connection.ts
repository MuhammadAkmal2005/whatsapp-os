/**
 * Database connection lifecycle.
 *
 * Prisma connects lazily: the client is constructed at module load but the
 * handshake — DNS, TCP, TLS, SCRAM, pooler admission, a Neon compute wake if the
 * endpoint was suspended, and Rust query-engine init — is deferred to the first
 * query. In a long-lived server that cost is invisible. In a Netlify function it
 * lands inside the first request the container serves, in front of that request's
 * real work.
 *
 * This module moves it. `warmUpDatabase()` is called once from
 * `instrumentation.ts` when a server instance bootstraps, without being awaited,
 * so the handshake — which is almost entirely waiting on the network — overlaps
 * the CPU-bound remainder of the Next.js bootstrap instead of following it. It
 * cannot make the handshake cheaper; it removes it from the critical path to the
 * extent the two overlap.
 *
 * Failure is not fatal. If the warm-up cannot connect, the request path is
 * unchanged: Prisma still connects lazily on its first query, exactly as before.
 */

import 'server-only';

import { isTest } from '@/config/env';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';

export { connectionConfigFacts, type ConnectionConfigFacts } from '@/db/connection-facts';

export type ConnectionLifecycle = {
  /** Whether this process has completed a connection handshake. */
  readonly warm: boolean;
  /** Wall time of the bootstrap warm-up, or null if it has not finished. */
  readonly bootstrapConnectMs: number | null;
};

/**
 * Module-scoped, which means it describes *this* module instance. If the server
 * bundle ever held two copies of this file, `warm` could read false on a
 * connected process — a discrepancy that would itself be worth knowing.
 */
const state: {
  warm: boolean;
  bootstrapConnectMs: number | null;
  inFlight: Promise<void> | null;
} = { warm: false, bootstrapConnectMs: null, inFlight: null };

/**
 * Establish the connection ahead of the first request. Idempotent, and safe to
 * call from anywhere: concurrent callers share one in-flight handshake.
 *
 * Never rejects. A warm-up that throws would surface as an unhandled rejection
 * during bootstrap and take the container down for a problem the lazy path
 * recovers from on its own.
 */
export function warmUpDatabase(): Promise<void> {
  // Unit tests inject fakes and must not open a socket on import.
  if (isTest) return Promise.resolve();
  if (state.inFlight) return state.inFlight;

  const startedAt = Date.now();

  state.inFlight = (async () => {
    await prisma.$connect();
    // $connect() opens the socket; one trivial round trip also forces the query
    // path itself to initialise, so the first real query has nothing left to set up.
    await prisma.$queryRaw`SELECT 1`;
    state.warm = true;
    state.bootstrapConnectMs = Date.now() - startedAt;
    logger.info('db.warmup.ready', { connectMs: state.bootstrapConnectMs });
  })().catch((error: unknown) => {
    // Clear the latch so a later caller can retry rather than await a dead promise.
    state.inFlight = null;
    logger.warn('db.warmup.failed', {
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return state.inFlight;
}

/** Records that a connection exists, for probes that connect by other means. */
export function markDatabaseWarm(): void {
  state.warm = true;
}

export function connectionLifecycle(): ConnectionLifecycle {
  return { warm: state.warm, bootstrapConnectMs: state.bootstrapConnectMs };
}

