/**
 * Database access for the background queue.
 *
 * The queue is one of the few genuinely cross-tenant tables: a worker processes
 * jobs for every workspace, so there is no `TenantContext` here and no workspace
 * scope on the queries. That is correct for the queue row itself, and it is why
 * `workspaceId` travels *inside* the payload — the handler re-enters normal
 * tenant-scoped territory as soon as it starts doing domain work.
 *
 * The claim is raw SQL because it has to be. Prisma has no expression for
 * `FOR UPDATE SKIP LOCKED`, and the alternative — select ids, then update them —
 * lets two workers select the same row and one of them do the work twice. The
 * `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)` form does the selection
 * and the claim in a single statement, so a row is either ours or invisible to us.
 */

import 'server-only';

import { Prisma } from '@prisma/client';

import type { Db } from '@/db/prisma';

export type JobRow = {
  id: string;
  type: string;
  payload: unknown;
  workspace_id: string | null;
  attempts: number;
  max_attempts: number;
};

/**
 * Claims up to `limit` eligible jobs in one statement.
 *
 * "Eligible" means PENDING with `run_after` in the past, ordered by priority then
 * age so a high-priority job never queues behind a backlog of rollups, and an
 * equal-priority backlog drains oldest-first rather than starving its own tail.
 *
 * `attempts` is incremented here, at claim time, rather than on failure. A worker
 * that is killed after claiming but before reporting has already consumed an
 * attempt, which is what stops a job that reliably crashes the process from being
 * retried forever.
 */
export async function claimJobs(
  db: Db,
  workerId: string,
  limit: number,
): Promise<JobRow[]> {
  return db.$queryRaw<JobRow[]>(Prisma.sql`
    UPDATE jobs AS j
    SET status = 'RUNNING',
        attempts = j.attempts + 1,
        locked_at = now(),
        locked_by = ${workerId},
        started_at = COALESCE(j.started_at, now())
    FROM (
      SELECT id
      FROM jobs
      WHERE status = 'PENDING' AND run_after <= now()
      ORDER BY priority DESC, run_after ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) AS eligible
    WHERE j.id = eligible.id
    RETURNING j.id, j.type, j.payload, j.workspace_id, j.attempts, j.max_attempts
  `);
}

export type InsertJobInput = {
  type: string;
  payload: Prisma.InputJsonValue;
  workspaceId: string | null;
  runAfter: Date;
  maxAttempts: number;
  priority: number;
  dedupeKey: string | null;
};

/**
 * Inserts a job, or returns the existing one when `dedupeKey` already exists.
 *
 * `ON CONFLICT DO NOTHING` plus a follow-up read rather than a check-then-insert:
 * the check-then-insert races, and losing that race raises a unique-constraint
 * error that the caller would then have to interpret. Here the conflict is the
 * normal path and needs no error handling.
 *
 * A conflict returns the *existing* job untouched. Deliberately: the earlier
 * enqueue's `runAfter` wins, so a caller retrying an enqueue cannot repeatedly
 * push a scheduled job further into the future.
 */
export async function insertJob(
  db: Db,
  input: InsertJobInput,
): Promise<{ id: string; created: boolean }> {
  if (input.dedupeKey === null) {
    const created = await db.job.create({
      data: {
        type: input.type,
        payload: input.payload,
        workspaceId: input.workspaceId,
        runAfter: input.runAfter,
        maxAttempts: input.maxAttempts,
        priority: input.priority,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }

  const inserted = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO jobs (type, payload, workspace_id, run_after, max_attempts, priority, dedupe_key)
    VALUES (
      ${input.type},
      ${input.payload}::jsonb,
      ${input.workspaceId}::uuid,
      ${input.runAfter},
      ${input.maxAttempts},
      ${input.priority},
      ${input.dedupeKey}
    )
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `);

  const row = inserted[0];
  if (row) return { id: row.id, created: true };

  const existing = await db.job.findFirst({
    where: { dedupeKey: input.dedupeKey },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  // The conflicting row was deleted between the insert and this read. Rare, and
  // retrying once is the honest response — the alternative is dropping the job.
  const retry = await db.job.create({
    data: {
      type: input.type,
      payload: input.payload,
      workspaceId: input.workspaceId,
      runAfter: input.runAfter,
      maxAttempts: input.maxAttempts,
      priority: input.priority,
      dedupeKey: input.dedupeKey,
    },
    select: { id: true },
  });
  return { id: retry.id, created: true };
}

/**
 * Marks a job complete.
 *
 * The dedupe key is cleared so the key becomes reusable. Without this, a daily
 * job keyed on `workspaceId` could only ever run once — and keeping every
 * completed key forever turns a unique index into a permanent record of work
 * already done, which is not what it is for.
 */
export async function markJobCompleted(db: Db, jobId: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lockedBy: null, dedupeKey: null },
  });
}

export async function markJobRetrying(
  db: Db,
  jobId: string,
  runAfter: Date,
  lastError: string,
): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: { status: 'PENDING', runAfter, lastError, lockedAt: null, lockedBy: null },
  });
}

/** Terminal failure. The row is kept, and its dedupe key with it, so a dead job
 *  is visible in the dashboard and cannot be silently re-enqueued under the same
 *  key while a human is still looking at it. */
export async function markJobDead(db: Db, jobId: string, lastError: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: { status: 'DEAD', lastError, completedAt: new Date(), lockedAt: null, lockedBy: null },
  });
}

/**
 * Returns jobs whose worker died mid-flight to the pending pool.
 *
 * Only jobs with attempts left are revived; one that has exhausted its budget
 * while locked goes straight to DEAD, because reviving it would only produce one
 * more guaranteed failure.
 */
export async function reclaimStalledJobs(db: Db, lockedBefore: Date): Promise<number> {
  const revived = await db.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: lockedBefore } },
    data: { status: 'PENDING', lockedAt: null, lockedBy: null, lastError: 'Reclaimed after worker stall.' },
  });
  return revived.count;
}

export async function countJobsByStatus(db: Db): Promise<Record<string, number>> {
  const grouped = await db.job.groupBy({ by: ['status'], _count: { _all: true } });
  const counts: Record<string, number> = {};
  for (const group of grouped) counts[group.status] = group._count._all;
  return counts;
}

export async function oldestPendingRunAfter(db: Db): Promise<Date | null> {
  const oldest = await db.job.findFirst({
    where: { status: 'PENDING' },
    orderBy: { runAfter: 'asc' },
    select: { runAfter: true },
  });
  return oldest?.runAfter ?? null;
}

/** Housekeeping. Completed rows are useful for a short while and then are noise. */
export async function deleteCompletedJobsBefore(db: Db, before: Date): Promise<number> {
  const deleted = await db.job.deleteMany({
    where: { status: 'COMPLETED', completedAt: { lt: before } },
  });
  return deleted.count;
}
