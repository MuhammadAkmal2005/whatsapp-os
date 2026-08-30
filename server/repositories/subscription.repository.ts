/**
 * Subscription repository.
 *
 * A workspace has at most one subscription (unique on `workspaceId`). New
 * workspaces open on a trial of the configured plan; the period end and trial
 * end are computed by the service from the plan catalogue, never hard-coded
 * here.
 */

import 'server-only';

import { getPlan, isPlanKey, type PlanKey } from '@/config/plans';
import type { Db } from '@/db/prisma';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';

export type CreateSubscriptionInput = {
  workspaceId: string;
  planKey: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  provider?: string | null;
  providerSubscriptionId?: string | null;
};

export async function createSubscription(
  db: Db,
  input: CreateSubscriptionInput,
): Promise<{ id: string }> {
  return db.subscription.create({
    data: {
      workspaceId: input.workspaceId,
      planKey: input.planKey,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      trialEndsAt: input.trialEndsAt,
      provider: input.provider,
      providerSubscriptionId: input.providerSubscriptionId,
    },
    select: { id: true },
  });
}

export type SubscriptionRecord = {
  id: string;
  workspaceId: string;
  planKey: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  provider: string | null;
  providerSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function findSubscription(
  db: Db,
  workspaceId: string,
): Promise<SubscriptionRecord | null> {
  return db.subscription.findUnique({
    where: { workspaceId },
    select: {
      id: true,
      workspaceId: true,
      planKey: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      cancelAtPeriodEnd: true,
      canceledAt: true,
      provider: true,
      providerSubscriptionId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function updateSubscriptionPlan(
  db: Db,
  workspaceId: string,
  data: {
    planKey: string;
    status?: SubscriptionStatus;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    trialEndsAt?: Date | null;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: Date | null;
    provider?: string | null;
    providerSubscriptionId?: string | null;
  },
): Promise<SubscriptionRecord> {
  return db.subscription.update({
    where: { workspaceId },
    data,
    select: {
      id: true,
      workspaceId: true,
      planKey: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      cancelAtPeriodEnd: true,
      canceledAt: true,
      provider: true,
      providerSubscriptionId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function setSubscriptionCancelAtPeriodEnd(
  db: Db,
  workspaceId: string,
  cancelAtPeriodEnd: boolean,
): Promise<SubscriptionRecord> {
  return db.subscription.update({
    where: { workspaceId },
    data: {
      cancelAtPeriodEnd,
      canceledAt: cancelAtPeriodEnd ? new Date() : null,
    },
    select: {
      id: true,
      workspaceId: true,
      planKey: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      cancelAtPeriodEnd: true,
      canceledAt: true,
      provider: true,
      providerSubscriptionId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Calculates the effective plan key for a workspace given its subscription state.
 *
 * Rules:
 * 1. Missing subscription -> 'free'
 * 2. Status 'EXPIRED' or 'CANCELED' (past period end) -> 'free'
 * 3. Status 'TRIAL' with trialEndsAt in the past -> 'free' (Trial expired, drops to free)
 * 4. Status 'ACTIVE' (or 'PAST_DUE' grace period or valid active 'TRIAL') -> configured planKey
 */
export function resolveEffectivePlanKey(
  sub: {
    planKey: string;
    status: SubscriptionStatus;
    trialEndsAt?: Date | null;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
  } | null,
  now: Date = new Date(),
): PlanKey {
  if (!sub) {
    return 'free';
  }

  const rawKey = isPlanKey(sub.planKey) ? sub.planKey : 'free';

  if (sub.status === 'EXPIRED') {
    return 'free';
  }

  if (sub.status === 'TRIAL') {
    if (sub.trialEndsAt && now.getTime() > sub.trialEndsAt.getTime()) {
      return 'free';
    }
    return rawKey;
  }

  if (sub.status === 'CANCELED') {
    if (sub.currentPeriodEnd && now.getTime() > sub.currentPeriodEnd.getTime()) {
      return 'free';
    }
    return rawKey;
  }

  if (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') {
    if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd && now.getTime() > sub.currentPeriodEnd.getTime()) {
      return 'free';
    }
    return rawKey;
  }

  return rawKey;
}
