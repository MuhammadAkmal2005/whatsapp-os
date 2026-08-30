/**
 * Subscription & Billing Service.
 *
 * Handles workspace subscription management, plan changes, trial lifecycle,
 * cancellation/resumption, and subscription authorization.
 */

import 'server-only';

import { DEFAULT_TRIAL_PLAN_KEY, getPlan, isPlanKey, ORDERED_PLANS, type Plan, type PlanKey } from '@/config/plans';
import { type Db, prisma } from '@/db/prisma';
import { BusinessRuleError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import { createNotification } from '@/server/repositories/notification.repository';
import { ensurePlanExists } from '@/server/repositories/plan.repository';
import {
  createSubscription,
  findSubscription,
  resolveEffectivePlanKey,
  setSubscriptionCancelAtPeriodEnd,
  type SubscriptionRecord,
  type SubscriptionStatus,
  updateSubscriptionPlan,
} from '@/server/repositories/subscription.repository';
import { getAllQuotaUsage, type QuotaMetricUsage } from '@/server/services/billing/limit-guard.service';
import { can, requirePermission, type TenantContext } from '@/server/tenancy/context';
import type { ChangePlanInput } from '@/server/validation/subscription';

export type WorkspaceSubscriptionOverviewDTO = {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    planKey: PlanKey;
    effectivePlanKey: PlanKey;
    isTrial: boolean;
    isTrialExpired: boolean;
    trialEndsAt: string | null;
    trialDaysRemaining: number | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
  };
  plan: Plan;
  configuredPlan: Plan;
};

export type WorkspaceBillingSummaryDTO = {
  subscription: WorkspaceSubscriptionOverviewDTO['subscription'];
  plan: Plan;
  configuredPlan: Plan;
  allPlans: Plan[];
  quotaUsage: QuotaMetricUsage[];
  canManage: boolean;
};

/**
 * Ensures a subscription record exists for the workspace, initializing a default trial if needed.
 */
export async function ensureWorkspaceSubscription(
  db: Db,
  workspaceId: string,
): Promise<SubscriptionRecord> {
  const existing = await findSubscription(db, workspaceId);
  if (existing) {
    return existing;
  }

  await ensurePlanExists(db, DEFAULT_TRIAL_PLAN_KEY);
  const trialDays = getPlan(DEFAULT_TRIAL_PLAN_KEY).trialDays;
  const now = new Date();
  const periodEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

  await createSubscription(db, {
    workspaceId,
    planKey: DEFAULT_TRIAL_PLAN_KEY,
    status: 'TRIAL',
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    trialEndsAt: periodEnd,
  });

  const created = await findSubscription(db, workspaceId);
  if (!created) {
    throw new Error(`Failed to create default subscription for workspace ${workspaceId}`);
  }
  return created;
}

/**
 * Gets the workspace subscription overview including effective plan and trial status.
 * Requires `subscription:read` (ADMIN, OWNER).
 */
export async function getSubscriptionOverview(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<WorkspaceSubscriptionOverviewDTO> {
  requirePermission(ctx, 'subscription:read');

  const sub = await ensureWorkspaceSubscription(db, ctx.workspaceId);

  const now = new Date();
  const effectivePlanKey = resolveEffectivePlanKey(sub, now);
  const plan = getPlan(effectivePlanKey);
  const configuredPlan = getPlan(sub.planKey);

  const isTrial = sub.status === 'TRIAL';
  const isTrialExpired = isTrial && Boolean(sub.trialEndsAt && now.getTime() > sub.trialEndsAt.getTime());

  let trialDaysRemaining: number | null = null;
  if (isTrial && sub.trialEndsAt) {
    const diffMs = sub.trialEndsAt.getTime() - now.getTime();
    trialDaysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  return {
    subscription: {
      id: sub.id,
      status: sub.status,
      planKey: isPlanKey(sub.planKey) ? sub.planKey : 'free',
      effectivePlanKey,
      isTrial,
      isTrialExpired,
      trialEndsAt: sub.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
      trialDaysRemaining,
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt ? sub.canceledAt.toISOString() : null,
    },
    plan,
    configuredPlan,
  };
}

/**
 * Changes the active workspace subscription plan.
 * Requires `subscription:manage` (OWNER only).
 */
export async function changeSubscriptionPlan(
  ctx: TenantContext,
  input: ChangePlanInput,
  db: Db = prisma,
): Promise<WorkspaceSubscriptionOverviewDTO> {
  requirePermission(ctx, 'subscription:manage');

  const targetPlanKey = input.planKey;
  const targetPlan = getPlan(targetPlanKey);

  // Ensure plan exists in DB plans table
  await ensurePlanExists(db, targetPlanKey);

  const currentSub = await ensureWorkspaceSubscription(db, ctx.workspaceId);
  const oldPlanKey = currentSub.planKey;
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const updated = await updateSubscriptionPlan(db, ctx.workspaceId, {
    planKey: targetPlanKey,
    status: 'ACTIVE',
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    trialEndsAt: null, // Subscribing/switching clears trial
    cancelAtPeriodEnd: false,
    canceledAt: null,
  });

  // Audit log
  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    action: 'subscription.plan_changed',
    resourceType: 'Subscription',
    resourceId: updated.id,
    metadata: {
      fromPlan: oldPlanKey,
      toPlan: targetPlanKey,
      priceMinor: targetPlan.priceMinor,
      currency: targetPlan.currency,
    },
  });

  // Create in-app notification
  await createNotification(db, ctx.workspaceId, {
    type: 'SUBSCRIPTION_CHANGED',
    level: 'INFO',
    title: `Plan changed to ${targetPlan.name}`,
    body: `Your workspace subscription has been updated to the ${targetPlan.name} plan.`,
    resourceType: 'Subscription',
    resourceId: updated.id,
  });

  return getSubscriptionOverview(ctx, db);
}

/**
 * Cancels a subscription at the end of the current billing period.
 * Requires `subscription:manage` (OWNER only).
 */
export async function cancelSubscription(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<WorkspaceSubscriptionOverviewDTO> {
  requirePermission(ctx, 'subscription:manage');

  const currentSub = await ensureWorkspaceSubscription(db, ctx.workspaceId);

  if (currentSub.planKey === 'free') {
    throw new BusinessRuleError('Free plan cannot be canceled.');
  }

  const updated = await setSubscriptionCancelAtPeriodEnd(db, ctx.workspaceId, true);

  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    action: 'subscription.canceled',
    resourceType: 'Subscription',
    resourceId: updated.id,
    metadata: {
      planKey: updated.planKey,
      cancelAt: updated.currentPeriodEnd.toISOString(),
    },
  });

  return getSubscriptionOverview(ctx, db);
}

/**
 * Resumes a subscription that was scheduled for cancellation at period end.
 * Requires `subscription:manage` (OWNER only).
 */
export async function resumeSubscription(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<WorkspaceSubscriptionOverviewDTO> {
  requirePermission(ctx, 'subscription:manage');

  await ensureWorkspaceSubscription(db, ctx.workspaceId);
  const updated = await setSubscriptionCancelAtPeriodEnd(db, ctx.workspaceId, false);

  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    action: 'subscription.resumed',
    resourceType: 'Subscription',
    resourceId: updated.id,
    metadata: {
      planKey: updated.planKey,
    },
  });

  return getSubscriptionOverview(ctx, db);
}

/**
 * Returns comprehensive billing summary including active subscription, full plan catalogue,
 * quota metrics usage, and caller permissions for the billing dashboard UI.
 * Requires `subscription:read` (ADMIN, OWNER).
 */
export async function getWorkspaceBillingSummary(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<WorkspaceBillingSummaryDTO> {
  requirePermission(ctx, 'subscription:read');

  const overview = await getSubscriptionOverview(ctx, db);
  const quotaUsage = await getAllQuotaUsage(ctx, db);
  const canManage = can(ctx, 'subscription:manage');

  return {
    ...overview,
    allPlans: ORDERED_PLANS,
    quotaUsage,
    canManage,
  };
}
