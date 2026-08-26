/**
 * Subscription repository.
 *
 * A workspace has at most one subscription (unique on `workspaceId`). New
 * workspaces open on a trial of the configured plan; the period end and trial
 * end are computed by the service from the plan catalogue, never hard-coded
 * here.
 */

import 'server-only';

import type { Db } from '@/db/prisma';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';

export type CreateSubscriptionInput = {
  workspaceId: string;
  planKey: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
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
    },
    select: { id: true },
  });
}

export type SubscriptionRecord = {
  id: string;
  planKey: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
};

export async function findSubscription(
  db: Db,
  workspaceId: string,
): Promise<SubscriptionRecord | null> {
  return db.subscription.findUnique({
    where: { workspaceId },
    select: {
      id: true,
      planKey: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      cancelAtPeriodEnd: true,
    },
  });
}
