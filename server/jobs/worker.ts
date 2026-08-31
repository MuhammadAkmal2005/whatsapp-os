/**
 * The worker loop.
 *
 * Claim a batch, run each job, report the outcome, sleep if there was nothing to
 * do. The loop itself is uninteresting; the parts worth explaining are the three
 * things it does carefully.
 *
 * **Polling, not listening.** The driver polls rather than using `LISTEN/NOTIFY`.
 * A notification is lost if no worker is connected when it fires, so a
 * notify-driven queue still needs a poll as a backstop, which means implementing
 * both. Polling every second is a trivial indexed query and the added latency is
 * invisible next to a WhatsApp round trip.
 *
 * **Concurrency without a scheduler.** Jobs in a batch run concurrently up to
 * `concurrency`, and the loop claims at most as many as it has free slots. That
 * keeps the claim and the capacity in step, so a worker never holds a lock on a
 * job it has not started.
 *
 * **Draining on shutdown.** SIGTERM stops claiming and waits for in-flight jobs,
 * bounded by a grace period. Killing a worker mid-job is safe — the reclaim window
 * exists for exactly that — but it means the job runs twice, so it is worth a few
 * seconds to avoid.
 */

import 'server-only';

import { logger } from '@/lib/logger';
import { metricsRegistry } from '@/server/telemetry/metrics';

import { getHandler } from './registry';
import type { ClaimedJob, JobQueue } from './queue';
import type { JobPayload, JobType } from './job-types';

export type WorkerOptions = {
  readonly queue: JobQueue;
  readonly workerId: string;
  readonly concurrency?: number;
  readonly pollIntervalMs?: number;
  /** How often to return stalled jobs to the pool. */
  readonly reclaimIntervalMs?: number;
  /** Bounds the wait for in-flight jobs on shutdown. */
  readonly shutdownGraceMs?: number;
};

export type Worker = {
  start(): Promise<void>;
  /** Resolves once in-flight jobs have finished or the grace period elapsed. */
  stop(): Promise<void>;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

export function createWorker(options: WorkerOptions): Worker {
  const concurrency = options.concurrency ?? 4;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const reclaimIntervalMs = options.reclaimIntervalMs ?? 60_000;
  const shutdownGraceMs = options.shutdownGraceMs ?? 20_000;

  const shutdown = new AbortController();
  const inFlight = new Set<Promise<void>>();
  let lastReclaimAt = 0;
  let running = false;

  async function runJob(job: ClaimedJob): Promise<void> {
    const handler = getHandler(job.type);

    if (!handler) {
      // Enqueued but nothing knows how to run it. Failing rather than dropping it
      // keeps the job visible; once a handler is deployed the retry succeeds.
      await options.queue.fail(job.id, new Error(`No handler registered for job type "${job.type}".`));
      metricsRegistry.jobsProcessed.inc({ type: job.type, status: 'failed' });
      logger.error('worker.no_handler', { jobId: job.id, type: job.type });
      return;
    }

    const startedAt = Date.now();
    try {
      await (handler as (payload: JobPayload<JobType>, context: unknown) => Promise<void>)(job.payload, {
        jobId: job.id,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        signal: shutdown.signal,
      });
      await options.queue.complete(job.id);
      const durationSec = (Date.now() - startedAt) / 1000;
      metricsRegistry.jobsProcessed.inc({ type: job.type, status: 'completed' });
      metricsRegistry.jobDuration.observe(durationSec, { type: job.type });
      logger.info('worker.job_completed', {
        jobId: job.id,
        type: job.type,
        workspaceId: job.workspaceId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await options.queue.fail(job.id, error);
      const durationSec = (Date.now() - startedAt) / 1000;
      metricsRegistry.jobsProcessed.inc({ type: job.type, status: 'failed' });
      metricsRegistry.jobDuration.observe(durationSec, { type: job.type });
      logger.error('worker.job_failed', {
        jobId: job.id,
        type: job.type,
        workspaceId: job.workspaceId,
        attempt: job.attempts,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function track(promise: Promise<void>): void {
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
  }

  async function tick(): Promise<number> {
    if (Date.now() - lastReclaimAt > reclaimIntervalMs) {
      lastReclaimAt = Date.now();
      // A failure here must not stop the loop — reclaiming is housekeeping, and a
      // transient database error should not take the worker down with it.
      await options.queue.reclaimStalled().catch((error: unknown) => {
        logger.error('worker.reclaim_failed', { error: String(error) });
        return 0;
      });
    }

    const capacity = concurrency - inFlight.size;
    if (capacity <= 0) return 0;

    const jobs = await options.queue.claim(options.workerId, capacity);
    for (const job of jobs) track(runJob(job));
    return jobs.length;
  }

  return {
    async start(): Promise<void> {
      if (running) throw new Error('Worker already started.');
      running = true;
      logger.info('worker.started', { workerId: options.workerId, concurrency });

      while (!shutdown.signal.aborted) {
        let claimed = 0;
        try {
          claimed = await tick();
        } catch (error) {
          // Almost always the database being briefly unreachable. Back off a full
          // poll interval and try again rather than spinning on the error.
          logger.error('worker.tick_failed', { error: error instanceof Error ? error.message : String(error) });
        }

        // Only idle when the queue was empty. A full batch means there is more
        // waiting, and sleeping through it adds latency for no reason.
        if (claimed === 0) await sleep(pollIntervalMs, shutdown.signal);
      }

      logger.info('worker.loop_exited', { workerId: options.workerId, inFlight: inFlight.size });
    },

    async stop(): Promise<void> {
      if (!running) return;
      shutdown.abort();

      const deadline = Date.now() + shutdownGraceMs;
      while (inFlight.size > 0 && Date.now() < deadline) {
        await Promise.race([Promise.allSettled([...inFlight]), sleep(250)]);
      }

      if (inFlight.size > 0) {
        logger.warn('worker.shutdown_abandoned', { workerId: options.workerId, inFlight: inFlight.size });
      }

      running = false;
      logger.info('worker.stopped', { workerId: options.workerId });
    },
  };
}
