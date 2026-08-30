import 'server-only';

import { type Db, prisma } from '@/db/prisma';
import { getPlan } from '@/config/plans';
import { logger } from '@/lib/logger';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import { createNotification } from '@/server/repositories/notification.repository';
import { ensurePlanExists } from '@/server/repositories/plan.repository';
import {
  findSubscription,
  updateSubscriptionPlan,
} from '@/server/repositories/subscription.repository';

export type BillingEvent = {
  type: 'checkout.session.completed' | 'customer.subscription.updated' | 'customer.subscription.deleted';
  data: {
    workspaceId: string;
    planKey: string;
    providerSubscriptionId: string;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
  };
};

/**
 * Idempotently processes a validated billing event.
 * If this were a real Stripe integration, `event` would be a Stripe Event object.
 * We normalize it to a `BillingEvent` interface so the logic is decoupled.
 */
export async function processBillingWebhook(
  event: BillingEvent,
  db: Db = prisma,
): Promise<void> {
  const { workspaceId, planKey, providerSubscriptionId } = event.data;

  if (event.type === 'checkout.session.completed') {
    await processCheckoutCompleted(event, db);
  } else if (event.type === 'customer.subscription.updated') {
    await processSubscriptionUpdated(event, db);
  } else if (event.type === 'customer.subscription.deleted') {
    await processSubscriptionDeleted(workspaceId, providerSubscriptionId, db);
  } else {
    logger.warn('billing.webhook.ignored_unknown_event_type', { type: event.type, workspaceId });
  }
}

async function processCheckoutCompleted(event: BillingEvent, db: Db) {
  const { workspaceId, planKey, providerSubscriptionId } = event.data;
  const plan = getPlan(planKey);
  await ensurePlanExists(db, planKey);

  const now = new Date();
  const periodStart = event.data.currentPeriodStart ? new Date(event.data.currentPeriodStart) : now;
  const periodEnd = event.data.currentPeriodEnd
    ? new Date(event.data.currentPeriodEnd)
    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const existingSub = await findSubscription(db, workspaceId);
  if (!existingSub) {
    // A workspace should always have a subscription, but if it doesn't, ensure one exists so we can update it
    const { ensureWorkspaceSubscription } = await import('@/server/services/subscription/subscription.service');
    await ensureWorkspaceSubscription(db, workspaceId);
  }

  // Directly mutate subscription row. This is safe against replay because:
  // 1. If it's a replay of the same event, the plan/dates are just set to the exact same values.
  // 2. We use providerSubscriptionId to link them.
  const updated = await updateSubscriptionPlan(db, workspaceId, {
    planKey,
    status: 'ACTIVE',
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    provider: 'mock',
    providerSubscriptionId,
  });

  if (existingSub?.planKey !== planKey || existingSub?.providerSubscriptionId !== providerSubscriptionId) {
    await appendAuditLog(db, {
      workspaceId,
      actorType: 'SYSTEM',
      action: 'subscription.plan_changed',
      resourceType: 'Subscription',
      resourceId: updated.id,
      metadata: {
        fromPlan: existingSub?.planKey,
        toPlan: planKey,
        providerEvent: 'checkout.session.completed',
        providerSubscriptionId,
      },
    });

    await createNotification(db, workspaceId, {
      type: 'SUBSCRIPTION_CHANGED',
      level: 'INFO',
      title: `Plan changed to ${plan.name}`,
      body: `Your workspace subscription has been updated to the ${plan.name} plan via payment.`,
      resourceType: 'Subscription',
      resourceId: updated.id,
    });
  }

  logger.info('billing.webhook.checkout_completed', { workspaceId, planKey, providerSubscriptionId });
}

async function processSubscriptionUpdated(event: BillingEvent, db: Db) {
  const { workspaceId, providerSubscriptionId } = event.data;
  const existingSub = await findSubscription(db, workspaceId);

  if (!existingSub || existingSub.providerSubscriptionId !== providerSubscriptionId) {
    logger.warn('billing.webhook.ignored_unknown_sub', { workspaceId, providerSubscriptionId });
    return;
  }

  const periodEnd = event.data.currentPeriodEnd ? new Date(event.data.currentPeriodEnd) : existingSub.currentPeriodEnd;
  const periodStart = event.data.currentPeriodStart ? new Date(event.data.currentPeriodStart) : existingSub.currentPeriodStart;
  const cancelAtPeriodEnd = event.data.cancelAtPeriodEnd ?? existingSub.cancelAtPeriodEnd;
  const planKey = event.data.planKey || existingSub.planKey;
  
  if (planKey !== existingSub.planKey) {
    await ensurePlanExists(db, planKey);
  }

  const updated = await updateSubscriptionPlan(db, workspaceId, {
    planKey,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd,
    canceledAt: cancelAtPeriodEnd ? new Date() : null,
  });

  if (existingSub.cancelAtPeriodEnd !== cancelAtPeriodEnd) {
    await appendAuditLog(db, {
      workspaceId,
      actorType: 'SYSTEM',
      action: cancelAtPeriodEnd ? 'subscription.canceled' : 'subscription.resumed',
      resourceType: 'Subscription',
      resourceId: existingSub.id,
      metadata: { providerEvent: 'customer.subscription.updated', providerSubscriptionId },
    });
  }

  logger.info('billing.webhook.subscription_updated', { workspaceId, providerSubscriptionId, planKey, cancelAtPeriodEnd });
}

async function processSubscriptionDeleted(workspaceId: string, providerSubscriptionId: string, db: Db) {
  const existingSub = await findSubscription(db, workspaceId);
  if (!existingSub || existingSub.providerSubscriptionId !== providerSubscriptionId) {
    logger.warn('billing.webhook.ignored_unknown_sub_delete', { workspaceId, providerSubscriptionId });
    return;
  }

  await updateSubscriptionPlan(db, workspaceId, {
    planKey: 'free',
    status: 'ACTIVE',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: new Date(),
    provider: null,
    providerSubscriptionId: null,
  });

  await appendAuditLog(db, {
    workspaceId,
    actorType: 'SYSTEM',
    action: 'subscription.canceled',
    resourceType: 'Subscription',
    resourceId: existingSub.id,
    metadata: { providerEvent: 'customer.subscription.deleted', providerSubscriptionId },
  });
  
  logger.info('billing.webhook.subscription_deleted', { workspaceId, providerSubscriptionId });
}
