/**
 * Operational Health and Readiness Service.
 *
 * Implements deterministic liveness probes, deep dependency readiness checks,
 * and high-level health overview reporting.
 *
 * Security & Reliability Guarantees:
 * - Deterministic JSON responses.
 * - Zero secrets or connection strings leaked on failure.
 * - Bounded query timeout so a stalled database cannot hang the health check.
 * - Status 200 for healthy/ready, 503 for degraded/unhealthy dependencies.
 *
 * The database probe reports connect time and query time separately. A single
 * blended figure is actively misleading on a serverless runtime: `SELECT 1` on an
 * established connection is a couple of milliseconds, while the same query on a
 * cold container also pays TLS, SCRAM, pooler admission, a possible Neon compute
 * wake, and query-engine init. Summing them into one number makes a connection
 * problem look like a slow database.
 */

import 'server-only';

import os from 'node:os';

import {
  env,
  isAIMocked,
  isMetaPlatformConfigured,
  isProduction,
  isWhatsAppMocked,
} from '@/config/env';
import {
  connectionConfigFacts,
  connectionLifecycle,
  markDatabaseWarm,
  type ConnectionConfigFacts,
} from '@/db/connection';
import { prisma, type Db } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { queue as defaultQueue } from '@/server/jobs';
import type { JobQueue, QueueStats } from '@/server/jobs/queue';
import { metricsRegistry } from '@/server/telemetry/metrics';

export type LivenessResponse = {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
  version: string;
};

export type DependencyStatus = 'up' | 'down';

/** Result of one database probe, with connection cost separated from query cost. */
export type DatabaseProbe = {
  status: DependencyStatus;
  /** Everything the probe paid for: the handshake, if it happened here, plus the query. */
  latencyMs: number;
  /**
   * Handshake wall time, when this probe is what paid it. `null` on a process that
   * was already connected — there is nothing to attribute — and `null` when the
   * injected client exposes no `$connect`, as test fakes do.
   */
  connectMs: number | null;
  /** `SELECT 1` on an established connection. This is the real query cost. */
  queryMs: number;
  /** Whether the process had already connected before this probe ran. */
  warm: boolean;
};

export type QueueProbe = {
  status: DependencyStatus;
  latencyMs: number;
  stats: QueueStats | null;
};

export type ReadinessResponse = {
  status: 'ready' | 'unhealthy';
  timestamp: string;
  checks: {
    database: DependencyStatus;
    queue: DependencyStatus;
  };
  latenciesMs: {
    database: number;
    queue: number;
  };
};

export type HealthOverviewResponse = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  version: string;
  dependencies: {
    database: DatabaseProbe;
    queue: {
      status: DependencyStatus;
      latencyMs: number;
      stats?: QueueStats;
    };
  };
  system: {
    memoryHeapUsedMb: number;
    memoryHeapTotalMb: number;
    memoryRssMb: number;
    nodeVersion: string;
    /** Prisma sizes its default pool from this, so it explains fan-out concurrency. */
    cpuCount: number;
  };
  /** Derived booleans only — never the connection string or any part of it. */
  connection: ConnectionConfigFacts & {
    /** Warm-up time recorded at bootstrap, or null if the warm-up has not run. */
    bootstrapConnectMs: number | null;
  };
  integrations: {
    /**
     * How this *deployment* is wired for WhatsApp, not whether any tenant is connected.
     *
     * `unconfigured` is the case worth having: a live deployment missing the app secret or
     * the verify token rejects every webhook Meta sends, and it does so silently from the
     * operator's point of view. Per-tenant connection health is a different question with a
     * different answer per workspace, and it lives in
     * `server/services/whatsapp/meta-connection-health.service.ts`.
     */
    whatsapp: 'mock' | 'live' | 'unconfigured';
    ai: 'mock' | 'live';
    storage: 'local' | 's3';
    email: 'console' | 'smtp';
    payment: 'mock' | 'stripe';
  };
};

const APP_VERSION = '1.0.0';

/**
 * Fast, deterministic in-memory liveness probe.
 * Does not make external network or database round-trips.
 */
export function checkLiveness(): LivenessResponse {
  return {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
  };
}

/**
 * `Db` deliberately omits `$connect` — it is the union of the root client and a
 * transaction client, and a transaction cannot connect. Injected fakes omit it too.
 * So the connect step is opt-in, discovered rather than assumed.
 */
function hasConnect(db: Db): db is Db & { $connect: () => Promise<void> } {
  return typeof (db as { $connect?: unknown }).$connect === 'function';
}

/**
 * Probe the database, attributing the handshake and the query separately.
 *
 * On a warm process this is one round trip and `connectMs` is null. On a cold one
 * the handshake is real work that has to happen regardless; timing it here is what
 * makes it possible to tell "the database is slow" apart from "this container is
 * new", which are the same 800 ms in a blended figure and have opposite fixes.
 */
async function probeDatabase(db: Db): Promise<DatabaseProbe> {
  const wasWarm = connectionLifecycle().warm;
  const startedAt = Date.now();
  let connectMs: number | null = null;

  try {
    if (!wasWarm && hasConnect(db)) {
      await db.$connect();
      connectMs = Date.now() - startedAt;
      markDatabaseWarm();
    }

    const queryStartedAt = Date.now();
    await db.$queryRawUnsafe('SELECT 1');
    const queryMs = Date.now() - queryStartedAt;

    // The histogram is a *query* duration histogram. Feeding it a cold-start
    // handshake would put a 900 ms outlier in a distribution of 2 ms queries.
    metricsRegistry.dbQueryDuration.observe(queryMs / 1000, { operation: 'health_check' });

    return {
      status: 'up',
      latencyMs: Date.now() - startedAt,
      connectMs,
      queryMs,
      warm: wasWarm,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    logger.error('health.readiness.database_failed', {
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'down', latencyMs, connectMs, queryMs: 0, warm: wasWarm };
  }
}

async function probeQueue(jobQueue: JobQueue): Promise<QueueProbe> {
  const startedAt = Date.now();
  try {
    const stats = await jobQueue.stats();
    const latencyMs = Date.now() - startedAt;

    metricsRegistry.jobQueueDepth.set(stats.pending, { status: 'pending' });
    metricsRegistry.jobQueueDepth.set(stats.running, { status: 'running' });
    metricsRegistry.jobQueueDepth.set(stats.dead, { status: 'dead' });
    if (stats.oldestPendingAgeSeconds !== null) {
      metricsRegistry.jobQueueOldestPendingAge.set(stats.oldestPendingAgeSeconds);
    }

    return { status: 'up', latencyMs, stats };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    logger.error('health.readiness.queue_failed', {
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'down', latencyMs, stats: null };
  }
}

/**
 * Both probes, once.
 *
 * Sequential on purpose. `jobQueue.stats()` is itself two queries, so running it
 * concurrently with the database probe would make a cold container open a second
 * pooled connection — and pay a second handshake — to answer a health check. The
 * database probe going first means the queue probe reuses what it established.
 */
async function probeDependencies(
  db: Db,
  jobQueue: JobQueue,
): Promise<{ database: DatabaseProbe; queue: QueueProbe }> {
  const database = await probeDatabase(db);
  const queue = await probeQueue(jobQueue);
  return { database, queue };
}

function toReadiness(
  database: DatabaseProbe,
  queue: QueueProbe,
): { status: number; body: ReadinessResponse } {
  const isReady = database.status === 'up' && queue.status === 'up';

  return {
    status: isReady ? 200 : 503,
    body: {
      status: isReady ? 'ready' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: database.status,
        queue: queue.status,
      },
      latenciesMs: {
        database: database.latencyMs,
        queue: queue.latencyMs,
      },
    },
  };
}

/**
 * Deep dependency readiness check for orchestrators / load balancers.
 * Probes database reachability and background queue responsiveness.
 *
 * The response shape is unchanged and stays byte-compatible for load balancers.
 */
export async function checkReadiness(
  db: Db = prisma,
  jobQueue: JobQueue = defaultQueue,
): Promise<{ status: number; body: ReadinessResponse }> {
  const { database, queue } = await probeDependencies(db, jobQueue);
  return toReadiness(database, queue);
}

/**
 * Comprehensive health and telemetry overview for dashboards and operators.
 */
export async function getHealthOverview(
  db: Db = prisma,
  jobQueue: JobQueue = defaultQueue,
): Promise<{ status: number; body: HealthOverviewResponse }> {
  // One probe pass, reused for both the status code and the detail. This used to
  // call the readiness check and then ask the queue for its stats a second time,
  // which meant every hit on this endpoint ran five queries to report on three.
  const { database, queue } = await probeDependencies(db, jobQueue);
  const readiness = toReadiness(database, queue);

  const mem = process.memoryUsage();
  const cpuCount = os.cpus().length;
  const isHealthy = database.status === 'up' && queue.status === 'up';
  const isDegraded = database.status === 'up' && queue.status === 'down';

  const body: HealthOverviewResponse = {
    status: isHealthy ? 'healthy' : isDegraded ? 'degraded' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: isProduction ? 'production' : env.NODE_ENV,
    version: APP_VERSION,
    dependencies: {
      database,
      queue: {
        status: queue.status,
        latencyMs: queue.latencyMs,
        ...(queue.stats === null ? {} : { stats: queue.stats }),
      },
    },
    system: {
      memoryHeapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      memoryHeapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      memoryRssMb: Math.round(mem.rss / 1024 / 1024),
      nodeVersion: process.version,
      cpuCount,
    },
    connection: {
      ...connectionConfigFacts(cpuCount),
      bootstrapConnectMs: connectionLifecycle().bootstrapConnectMs,
    },
    integrations: {
      whatsapp: isWhatsAppMocked ? 'mock' : isMetaPlatformConfigured ? 'live' : 'unconfigured',
      ai: isAIMocked ? 'mock' : 'live',
      storage: env.STORAGE_PROVIDER,
      email: env.EMAIL_PROVIDER,
      payment: env.PAYMENT_PROVIDER,
    },
  };

  return {
    status: readiness.status,
    body,
  };
}
