/**
 * The queue singleton and the handler bootstrap.
 *
 * Application code imports `queue` from here and never names a driver. Swapping
 * PostgreSQL for Redis later is a change to `createQueue` and nothing else.
 */

import 'server-only';

import { env } from '@/config/env';
import { NotConfiguredError } from '@/server/errors';

import { createPostgresQueue } from './drivers/postgres-queue';
import type { JobQueue } from './queue';

function createQueue(): JobQueue {
  switch (env.QUEUE_DRIVER) {
    case 'postgres':
      return createPostgresQueue();
    case 'redis':
      // The config schema already requires REDIS_URL when this is selected, so the
      // gap is the driver itself. A clear error beats a driver invented from
      // memory of an API — see CLAUDE.md on never inventing an external client.
      throw new NotConfiguredError(
        'Redis queue driver',
        'QUEUE_DRIVER=redis is reserved for a future driver. Use QUEUE_DRIVER=postgres.',
      );
  }
}

/** Reused across hot reloads for the same reason the Prisma client is. */
const globalForQueue = globalThis as unknown as { jobQueue?: JobQueue };

export const queue: JobQueue = globalForQueue.jobQueue ?? createQueue();

if (env.NODE_ENV !== 'production') globalForQueue.jobQueue = queue;

export { dedupeKey } from './queue';
export type { ClaimedJob, EnqueueOptions, EnqueueResult, JobQueue, QueueStats } from './queue';
export type { JobPayload, JobType } from './job-types';
export { JOB_TYPES } from './job-types';
export { registerHandler, registeredTypes } from './registry';
export type { JobContext, JobHandler } from './registry';
