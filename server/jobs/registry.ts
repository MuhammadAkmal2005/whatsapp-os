/**
 * The handler registry.
 *
 * A job type is only runnable if something registered a handler for it. Keeping
 * registration separate from the catalogue in `job-types.ts` is what lets the
 * web process enqueue a job type whose handler lives in a module the web process
 * never imports — the worker registers it, the web process does not need to.
 *
 * Registration is explicit rather than filesystem-scanned. Scanning is tidier
 * until you are trying to work out why a job silently never ran, at which point
 * an explicit list you can read is worth a great deal.
 */

import 'server-only';

import type { JobPayload, JobType } from './job-types';

export type JobContext = {
  readonly jobId: string;
  /** 1 on the first run. Handlers use it to log, and occasionally to degrade —
   *  a last attempt might notify a human rather than fail silently. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Aborted when the worker is shutting down. A long handler should check it
   *  between units of work so a deploy does not have to wait for the slowest job. */
  readonly signal: AbortSignal;
};

export type JobHandler<T extends JobType> = (
  payload: JobPayload<T>,
  context: JobContext,
) => Promise<void>;

/**
 * Handlers must be idempotent.
 *
 * At-least-once delivery is not a limitation we plan to remove — it is inherent.
 * A worker can be killed after the work is done but before the completion write
 * lands, and the reclaim window will then hand the same job to someone else. So
 * every handler either checks whether its effect already happened or performs an
 * effect that is safe to repeat. "Send a WhatsApp message" is not naturally safe
 * to repeat, which is why the outbound send checks for a provider message id on
 * the row before calling the API.
 */
type HandlerMap = { [T in JobType]?: JobHandler<T> };

const handlers: HandlerMap = {};

export function registerHandler<T extends JobType>(type: T, handler: JobHandler<T>): void {
  if (handlers[type]) {
    // A duplicate registration means two modules disagree about who owns a job
    // type, and whichever loaded last would silently win. Fail at boot instead.
    throw new Error(`A handler is already registered for job type "${type}".`);
  }

  // A write through a generic key cannot be checked soundly: TypeScript widens the
  // target to the intersection of every JobHandler<…> in the map, which no single
  // handler satisfies. The narrowing is safe here because `type` and `handler` are
  // correlated by the same T at the call site, and `getHandler` reads back under
  // that same T. The cast is confined to this line rather than loosening the map.
  handlers[type] = handler as HandlerMap[T];
}

export function getHandler<T extends JobType>(type: T): JobHandler<T> | undefined {
  return handlers[type] as JobHandler<T> | undefined;
}

export function registeredTypes(): JobType[] {
  return Object.keys(handlers) as JobType[];
}

/** Test seam. Never call this from application code. */
export function resetHandlers(): void {
  for (const key of Object.keys(handlers)) {
    delete handlers[key as JobType];
  }
}
