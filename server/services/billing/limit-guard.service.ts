/**
 * Centralized Plan Limit & Feature Entitlement Guard Service.
 *
 * Enforces per-workspace subscription limits and feature entitlements across all
 * domain mutations (contacts, products, team members, automations, WhatsApp numbers, AI).
 *
 * Implements graceful degradation: read queries and inbound events always succeed;
 * only resource creation that would breach the workspace's quota is restricted.
 */

import 'server-only';

import {
  checkLimit,
  getPlan,
  type LimitCheck,
  type LimitName,
  type Plan,
  type PlanFeature,
  type PlanKey,
  planHasFeature,
} from '@/config/plans';
import { type Db, prisma } from '@/db/prisma';
import { ForbiddenError, LimitExceededError } from '@/server/errors';
import { createNotification } from '@/server/repositories/notification.repository';
import {
  findSubscription,
  resolveEffectivePlanKey,
} from '@/server/repositories/subscription.repository';
import { ensureWorkspaceSubscription } from '@/server/services/subscription/subscription.service';
import type { TenantContext } from '@/server/tenancy/context';

function formatPeriodKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Resolves the active effective plan key for the workspace, accounting for expired trials.
 */
export async function getEffectivePlanKey(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<PlanKey> {
  const sub = await ensureWorkspaceSubscription(db, ctx.workspaceId);
  return resolveEffectivePlanKey(sub, new Date());
}

/**
 * Resolves the full Plan object for the workspace.
 */
export async function getEffectivePlan(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<Plan> {
  const planKey = await getEffectivePlanKey(ctx, db);
  return getPlan(planKey);
}

/**
 * Counts currently consumed units for a specific metered limit in the workspace.
 */
export async function getCurrentLimitUsage(
  ctx: TenantContext,
  limitName: LimitName,
  db: Db = prisma,
): Promise<number> {
  const now = new Date();
  const periodKey = formatPeriodKey(now);

  switch (limitName) {
    case 'whatsappNumbers': {
      return db.whatsAppPhoneNumber.count({
        where: { workspaceId: ctx.workspaceId },
      });
    }

    case 'teamMembers': {
      const [members, pendingInvites] = await Promise.all([
        db.workspaceMember.count({
          where: { workspaceId: ctx.workspaceId, status: 'ACTIVE' },
        }),
        db.workspaceInvite.count({
          where: {
            workspaceId: ctx.workspaceId,
            expiresAt: { gt: now },
            acceptedAt: null,
            revokedAt: null,
          },
        }),
      ]);
      return members + pendingInvites;
    }

    case 'contacts': {
      return db.contact.count({
        where: { workspaceId: ctx.workspaceId, deletedAt: null },
      });
    }

    case 'products': {
      return db.product.count({
        where: { workspaceId: ctx.workspaceId, deletedAt: null },
      });
    }

    case 'automations': {
      return db.automation.count({
        where: { workspaceId: ctx.workspaceId },
      });
    }

    case 'aiRequestsPerMonth': {
      const counter = await db.usageCounter.findUnique({
        where: {
          workspaceId_metric_periodKey: {
            workspaceId: ctx.workspaceId,
            metric: 'AI_REQUEST',
            periodKey,
          },
        },
        select: { quantity: true },
      });
      return counter?.quantity ?? 0;
    }

    case 'messagesPerMonth': {
      const counter = await db.usageCounter.findUnique({
        where: {
          workspaceId_metric_periodKey: {
            workspaceId: ctx.workspaceId,
            metric: 'WHATSAPP_MESSAGE_SENT',
            periodKey,
          },
        },
        select: { quantity: true },
      });
      return counter?.quantity ?? 0;
    }

    case 'knowledgeDocuments': {
      return db.knowledgeDocument.count({
        where: { workspaceId: ctx.workspaceId },
      });
    }

    case 'storageMegabytes': {
      const counter = await db.usageCounter.findUnique({
        where: {
          workspaceId_metric_periodKey: {
            workspaceId: ctx.workspaceId,
            metric: 'STORAGE_BYTES',
            periodKey: 'total',
          },
        },
        select: { quantity: true },
      });
      const bytes = counter?.quantity ?? 0;
      return Math.ceil(bytes / (1024 * 1024));
    }

    case 'campaignsPerMonth': {
      const counter = await db.usageCounter.findUnique({
        where: {
          workspaceId_metric_periodKey: {
            workspaceId: ctx.workspaceId,
            metric: 'CAMPAIGN_MESSAGE',
            periodKey,
          },
        },
        select: { quantity: true },
      });
      return counter?.quantity ?? 0;
    }

    default:
      return 0;
  }
}

/**
 * Asserts that a workspace has sufficient quota to perform an action.
 * Throws `LimitExceededError` if the quota would be exceeded.
 */
export async function assertWithinPlanLimit(
  ctx: TenantContext,
  limitName: LimitName,
  requested = 1,
  db: Db = prisma,
): Promise<LimitCheck> {
  const effectivePlanKey = await getEffectivePlanKey(ctx, db);
  const currentUsage = await getCurrentLimitUsage(ctx, limitName, db);
  const check = checkLimit(effectivePlanKey, limitName, currentUsage, requested);

  if (!check.allowed) {
    const plan = getPlan(effectivePlanKey);
    const limitDisplay = check.limit ?? 'unlimited';
    throw new LimitExceededError(
      limitName,
      check.limit ?? 0,
      `Your ${plan.name} plan allows up to ${limitDisplay} ${limitName} (currently used: ${currentUsage}). Upgrade your plan to add more.`,
    );
  }

  return check;
}

/**
 * Asserts that the workspace's plan entitles it to use a specific feature.
 * Throws `ForbiddenError` if the feature is not included in the active plan.
 */
export async function assertPlanHasFeature(
  ctx: TenantContext,
  feature: PlanFeature,
  db: Db = prisma,
): Promise<void> {
  const effectivePlanKey = await getEffectivePlanKey(ctx, db);
  const entitled = planHasFeature(effectivePlanKey, feature);

  if (!entitled) {
    const plan = getPlan(effectivePlanKey);
    throw new ForbiddenError(
      `The "${feature}" feature is not included in your current ${plan.name} plan. Upgrade to unlock it.`,
    );
  }
}

export type QuotaMetricUsage = {
  metric: LimitName;
  label: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  ratio: number;
  nearLimit: boolean;
  isUnmetered: boolean;
};

/**
 * Computes the real-time usage and limits for all 10 quota metrics in the workspace.
 */
export async function getAllQuotaUsage(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<QuotaMetricUsage[]> {
  const plan = await getEffectivePlan(ctx, db);
  const metrics: { name: LimitName; label: string }[] = [
    { name: 'whatsappNumbers', label: 'WhatsApp Numbers' },
    { name: 'teamMembers', label: 'Team Members' },
    { name: 'contacts', label: 'Contacts' },
    { name: 'products', label: 'Products' },
    { name: 'automations', label: 'Automations' },
    { name: 'aiRequestsPerMonth', label: 'AI Requests (mo)' },
    { name: 'messagesPerMonth', label: 'Messages Sent (mo)' },
    { name: 'knowledgeDocuments', label: 'Knowledge Documents' },
    { name: 'storageMegabytes', label: 'Storage (MB)' },
    { name: 'campaignsPerMonth', label: 'Campaigns (mo)' },
  ];

  const results = await Promise.all(
    metrics.map(async (m) => {
      const used = await getCurrentLimitUsage(ctx, m.name, db);
      const check = checkLimit(plan.key, m.name, used, 0);
      return {
        metric: m.name,
        label: m.label,
        used,
        limit: check.limit,
        remaining: check.remaining,
        ratio: check.ratio,
        nearLimit: check.nearLimit,
        isUnmetered: check.limit === null,
      };
    }),
  );

  return results;
}
