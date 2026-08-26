/**
 * Worker entry point — `npm run worker`.
 *
 * A separate process from the web app on purpose. Sharing one process means a
 * runaway document ingestion competes for the event loop with a customer waiting
 * on an HTTP response, and it means you cannot scale the two independently. The
 * only thing they share is the database.
 *
 * Console output rather than the structured logger for the banner: this is a
 * foreground process a developer is watching, and the first thing they need to
 * know is which mode it came up in.
 */

import { hostname } from 'node:os';

import { env, isAIMocked, isWhatsAppMocked } from '@/config/env';
import { logger } from '@/lib/logger';
import { queue } from '@/server/jobs';
import { registerAllHandlers } from '@/server/jobs/handlers';
import { createWorker } from '@/server/jobs/worker';
import { dedupeKey } from '@/server/jobs/queue';

/** Host plus pid, so `locked_by` identifies a specific process when two workers
 *  on the same host are both holding jobs. */
const workerId = `${hostname()}-${process.pid}`;

/** Kept short so a hung job cannot hold a deployment open indefinitely. */
const SHUTDOWN_GRACE_MS = 20_000;

async function main(): Promise<void> {
  registerAllHandlers();

  console.log(
    [
      '',
      '  WhatsApp OS — background worker',
      `  worker id     ${workerId}`,
      `  queue driver  ${env.QUEUE_DRIVER}`,
      `  environment   ${env.NODE_ENV}`,
      `  whatsapp      ${isWhatsAppMocked ? 'MOCK — no real messages will be sent' : 'live'}`,
      `  ai            ${isAIMocked ? 'MOCK — deterministic canned replies' : env.AI_MODEL}`,
      '',
    ].join('\n'),
  );

  const worker = createWorker({ queue, workerId, shutdownGraceMs: SHUTDOWN_GRACE_MS });

  // The sweep is self-perpetuating: each run schedules the next. The dedupe key is
  // the hour bucket, so two workers racing to schedule it produce one job.
  await scheduleMaintenance();

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n  ${signal} received — draining in-flight jobs…`);
    void worker
      .stop()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error('worker.shutdown_failed', { error: String(error) });
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await worker.start();
}

async function scheduleMaintenance(): Promise<void> {
  const nextHour = new Date();
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);

  await queue.enqueue(
    'maintenance.sweep',
    {},
    { runAt: nextHour, dedupeKey: dedupeKey('maintenance.sweep', nextHour.toISOString()) },
  );
}

main().catch((error: unknown) => {
  // Boot failures are usually a misconfigured environment, and the env schema
  // already produces a readable list. Print it and exit non-zero so a supervisor
  // does not treat the process as healthy.
  console.error('\n  Worker failed to start.\n');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
