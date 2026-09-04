/**
 * Workspace service.
 *
 * Creating a workspace is the one operation in the auth flow with a multi-row
 * invariant: a workspace is not usable without an owner membership, a
 * subscription, a business-profile shell, and an AI agent, and a half-created
 * workspace is worse than none. So the writes run in a single transaction —
 * either the business exists completely or it does not exist at all.
 *
 * The trial plan and its length come from the plan catalogue, never from here,
 * so a pricing or policy change is made in one place.
 */

import 'server-only';

import { DEFAULT_AI_AGENT_GREETING, DEFAULT_AI_AGENT_NAME } from '@/config/constants';
import { env } from '@/config/env';
import { modelForTask } from '@/config/models';
import { DEFAULT_TRIAL_PLAN_KEY, getPlan } from '@/config/plans';
import { prisma } from '@/db/prisma';
import { workspaceSlug, slugSuffix } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { ValidationError } from '@/server/errors';
import { ensureDefaultAgent } from '@/server/repositories/ai-agent.repository';
import { appendAuditLog, appendProductEvent } from '@/server/repositories/audit.repository';
import { ensurePlanExists } from '@/server/repositories/plan.repository';
import { createSubscription } from '@/server/repositories/subscription.repository';
import {
  createBusinessProfileShell,
  createMembership,
  createWorkspace as createWorkspaceRow,
  countWorkspacesForUser,
  listWorkspacesForUser,
  slugExists,
  type WorkspaceSummary,
} from '@/server/repositories/workspace.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

export type CreateWorkspaceInput = {
  userId: string;
  name: string;
  category?: string | null;
  meta?: { ipAddress?: string | null; userAgent?: string | null };
};

export type CreatedWorkspace = WorkspaceSummary;

/**
 * Finds a slug that is free. The base is derived from the name; on collision a
 * short readable suffix is appended and re-checked. The final create still races
 * against the unique constraint, which is the real guarantee — this just keeps
 * the common case clean and the URL readable.
 */
async function resolveUniqueSlug(name: string): Promise<string> {
  const base = workspaceSlug(name);
  if (!(await slugExists(prisma, base))) return base;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${slugSuffix()}`;
    if (!(await slugExists(prisma, candidate))) return candidate;
  }
  // Astronomically unlikely to reach here; a fully random slug cannot collide in
  // practice and is preferable to failing the signup.
  return `${base}-${slugSuffix(8)}`;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<CreatedWorkspace> {
  const name = input.name.trim();
  if (name.length < 2) {
    throw new ValidationError('Please enter a business name of at least 2 characters.', {
      name: ['Please enter a business name of at least 2 characters.'],
    });
  }

  const slug = await resolveUniqueSlug(name);
  const now = new Date();

  const plan = getPlan(DEFAULT_TRIAL_PLAN_KEY);
  const isTrial = plan.trialDays > 0;
  const periodDays = isTrial ? plan.trialDays : 30;
  const periodEnd = new Date(now.getTime() + periodDays * DAY_MS);

  const created = await prisma.$transaction(async (tx) => {
    // The subscription's foreign key needs the plan row to exist; ensure it here
    // so a database that has never been seeded still completes a signup.
    await ensurePlanExists(tx, plan.key);

    const workspace = await createWorkspaceRow(tx, { name, slug, category: input.category ?? null });

    const membership = await createMembership(tx, {
      workspaceId: workspace.id,
      userId: input.userId,
      role: 'OWNER',
    });

    await createSubscription(tx, {
      workspaceId: workspace.id,
      planKey: plan.key,
      status: isTrial ? 'TRIAL' : 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEndsAt: isTrial ? periodEnd : null,
    });

    await createBusinessProfileShell(tx, workspace.id, { category: input.category ?? null });

    // Inside the transaction, alongside the profile shell, because an agentless
    // workspace is a broken one: the first customer message resolves no agent, the
    // AI job finishes without a reply, and nothing anywhere reports a problem.
    // `modelForTask` is what decides that customer-facing generation gets the
    // primary model rather than the cheap one, and it reads the configured
    // deployment — so the row is never stamped with a model the active provider
    // cannot serve.
    await ensureDefaultAgent(tx, workspace.id, {
      name: DEFAULT_AI_AGENT_NAME,
      greeting: DEFAULT_AI_AGENT_GREETING,
      model: modelForTask('conversation', {
        primary: env.AI_MODEL,
        fast: env.AI_MODEL_FAST,
      }),
    });

    return { workspace, membershipId: membership.id };
  });

  await Promise.all([
    appendAuditLog(prisma, {
      action: 'workspace.created',
      workspaceId: created.workspace.id,
      actorUserId: input.userId,
      actorMemberId: created.membershipId,
      actorType: 'USER',
      resourceType: 'workspace',
      resourceId: created.workspace.id,
      ipAddress: input.meta?.ipAddress ?? null,
      userAgent: input.meta?.userAgent ?? null,
      metadata: { name, slug, planKey: plan.key },
    }),
    appendProductEvent(prisma, {
      name: 'onboarding_started',
      workspaceId: created.workspace.id,
      userId: input.userId,
      properties: { planKey: plan.key },
    }),
  ]).catch((error) => {
    logger.error('Post-workspace-create bookkeeping failed', {
      error: String(error),
      workspaceId: created.workspace.id,
    });
  });

  logger.info('Workspace created', { workspaceId: created.workspace.id, slug });

  return {
    id: created.workspace.id,
    slug: created.workspace.slug,
    name: created.workspace.name,
    role: 'OWNER',
    status: 'ACTIVE',
    onboardingCompletedAt: null,
  };
}

/**
 * Every workspace the user belongs to, newest membership first, for the picker
 * screen and for post-login routing. The routing layer cannot open the Prisma
 * client itself, so this is the seam it calls; the read is not tenant-scoped by
 * design — its scope is the user, and it returns only workspaces they are a
 * member of.
 */
export async function listUserWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  return listWorkspacesForUser(prisma, userId);
}

/**
 * Count of the user's workspaces. Cheaper than listing when a caller only needs
 * to branch on "any" vs "none" (e.g. whether to send a fresh signup to
 * onboarding or the picker).
 */
export async function countUserWorkspaces(userId: string): Promise<number> {
  return countWorkspacesForUser(prisma, userId);
}
