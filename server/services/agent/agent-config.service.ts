/**
 * AI agent configuration service.
 *
 * The business rules behind the `/agent` screen: who may read the configuration, who may
 * change it, which fields may change at all, and what gets recorded when they do.
 *
 * Kept apart from `agent-runtime.service.ts` on purpose. That file answers customers; this
 * one answers the shop owner. They share the repository and nothing else, and the runtime
 * must not grow a dependency on anything a browser can reach.
 */

import 'server-only';

import { DEFAULT_AI_AGENT_GREETING, DEFAULT_AI_AGENT_NAME } from '@/config/constants';
import { env, isAIMocked } from '@/config/env';
import { modelForTask } from '@/config/models';
import { prisma, type Db } from '@/db/prisma';
import { NotFoundError } from '@/server/errors';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import {
  ensureDefaultAgent,
  findConfigurableAgent,
  updateAgentConfig as updateAgentConfigRow,
  type AIAgentWithInstructionsRow,
} from '@/server/repositories/ai-agent.repository';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import {
  AGENT_ROLES,
  AGENT_TONES,
  type AgentRoleValue,
  type AgentToneValue,
  type UpdateAgentConfigInput,
} from '@/server/validation/agent';

/**
 * What the configuration screen is given.
 *
 * A narrow projection rather than the repository row, because the row carries columns the
 * screen has no business rendering — `escalationRules`, `confidenceFloor`,
 * `businessHoursOnly` and `languages` are stored but nothing reads them, and a view model
 * that includes them invites a control that does nothing.
 *
 * `model` and `providerIsMock` are read-only facts about the deployment, not settings. They
 * are here because an owner deserves to know which engine is answering — and, in a mocked
 * deployment, that nothing real is answering at all.
 */
export type AgentConfigView = {
  id: string;
  name: string;
  role: AgentRoleValue;
  tone: AgentToneValue;
  persona: string | null;
  greeting: string | null;
  customInstructions: string | null;
  handoffKeywords: string[];
  temperature: number;
  maxOutputTokens: number;
  isActive: boolean;
  isDefault: boolean;
  model: string;
  providerIsMock: boolean;
  conversationsHandled: number;
  handoffCount: number;
  ordersCreated: number;
  updatedAt: Date;
};

/**
 * Narrows the two enum columns, which Prisma hands over as plain strings.
 *
 * A value outside the enum can only mean the database drifted from the schema, and the
 * honest response is to fall back to the schema's own default rather than to render a
 * picker with no selected option — which is how an owner saves a role they never chose.
 */
function toRole(value: string): AgentRoleValue {
  return (AGENT_ROLES as readonly string[]).includes(value)
    ? (value as AgentRoleValue)
    : 'SALES_SUPPORT';
}

function toTone(value: string): AgentToneValue {
  return (AGENT_TONES as readonly string[]).includes(value)
    ? (value as AgentToneValue)
    : 'FRIENDLY';
}

function toView(row: AIAgentWithInstructionsRow): AgentConfigView {
  return {
    id: row.id,
    name: row.name,
    role: toRole(row.role),
    tone: toTone(row.tone),
    persona: row.persona,
    greeting: row.greeting,
    customInstructions: row.customInstructions,
    handoffKeywords: row.handoffKeywords,
    temperature: row.temperature,
    maxOutputTokens: row.maxOutputTokens,
    isActive: row.isActive,
    isDefault: row.isDefault,
    model: row.model,
    providerIsMock: isAIMocked,
    conversationsHandled: row.conversationsHandled,
    handoffCount: row.handoffCount,
    ordersCreated: row.ordersCreated,
    updatedAt: row.updatedAt,
  };
}

/**
 * The workspace's assistant as configured, or null when the workspace has none.
 *
 * Null is a real state, not an error: a workspace provisioned before the agent bootstrap
 * existed has no row. The screen renders that honestly and offers to create one, rather
 * than this function writing to the database during a page render.
 *
 * Returns the agent whether or not it is active, which is the whole reason this path does
 * not reuse the runtime's resolver — an owner who switched the assistant off must be able
 * to find it again and switch it back on.
 */
export async function getAgentConfig(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<AgentConfigView | null> {
  requirePermission(ctx, 'agent:read');

  const row = await findConfigurableAgent(db, ctx.workspaceId);
  return row ? toView(row) : null;
}

/**
 * Creates the workspace's assistant if it has none, and returns it either way.
 *
 * Delegates to the same `ensureDefaultAgent` that workspace provisioning uses, so there is
 * one definition of what a new agent looks like. That function is idempotent by lookup over
 * *any* agent — active, inactive, default or not — so a double-click, a retry, or two
 * members pressing the button at once cannot produce a second agent or a second default.
 */
export async function provisionAgentConfig(
  ctx: TenantContext,
  db: Db = prisma,
): Promise<AgentConfigView> {
  requirePermission(ctx, 'agent:update');

  const { id, created } = await ensureDefaultAgent(db, ctx.workspaceId, {
    name: DEFAULT_AI_AGENT_NAME,
    greeting: DEFAULT_AI_AGENT_GREETING,
    model: modelForTask('conversation', {
      primary: env.AI_MODEL,
      fast: env.AI_MODEL_FAST,
    }),
  });

  if (created) {
    await appendAuditLog(db, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      actorMemberId: ctx.membershipId,
      actorType: 'USER',
      action: 'agent.created',
      resourceType: 'AIAgent',
      resourceId: id,
      metadata: { name: DEFAULT_AI_AGENT_NAME },
    });
  }

  const row = await findConfigurableAgent(db, ctx.workspaceId);
  if (!row) throw new NotFoundError('AI assistant');
  return toView(row);
}

/**
 * Saves the owner's configuration.
 *
 * The agent id is resolved here from the tenant context rather than accepted from the
 * caller. The product manages one assistant per workspace, so there is nothing for a
 * browser-supplied id to disambiguate, and not accepting one removes the whole class of
 * bug where a form field decides which row gets written.
 *
 * Only the fields named in `AgentConfigUpdateFields` are written. `model` is not among them:
 * the deployment stamps it at provisioning, exactly one provider adapter is wired, and no
 * catalogued model identifier is one that provider can serve — so a picker would be a
 * choice between values that do not work.
 */
export async function updateAgentConfiguration(
  ctx: TenantContext,
  input: UpdateAgentConfigInput,
  db: Db = prisma,
): Promise<AgentConfigView> {
  requirePermission(ctx, 'agent:update');

  const existing = await findConfigurableAgent(db, ctx.workspaceId);
  if (!existing) {
    throw new NotFoundError('AI assistant');
  }

  const updated = await updateAgentConfigRow(db, ctx.workspaceId, existing.id, {
    name: input.name,
    role: input.role,
    tone: input.tone,
    persona: input.persona,
    greeting: input.greeting,
    customInstructions: input.customInstructions,
    handoffKeywords: input.handoffKeywords,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    isActive: input.isActive,
  });

  // The row was found a moment ago and the update is scoped to the same workspace, so this
  // is a concurrent delete rather than a tenancy failure. `NotFoundError` is right either
  // way: it never confirms whether an id exists in some other workspace.
  if (!updated) {
    throw new NotFoundError('AI assistant');
  }

  await appendAuditLog(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.user.id,
    actorMemberId: ctx.membershipId,
    actorType: 'USER',
    action: 'agent.updated',
    resourceType: 'AIAgent',
    resourceId: updated.id,
    // Which knobs moved, not what they now say. The persona and the instructions are the
    // owner's own words and can run to pages; the ledger is for answering "who changed the
    // assistant, when, and did they switch it off", and the values themselves are one read
    // of the row away.
    metadata: {
      name: updated.name,
      role: updated.role,
      tone: updated.tone,
      isActive: updated.isActive,
      temperature: updated.temperature,
      maxOutputTokens: updated.maxOutputTokens,
      handoffKeywordCount: updated.handoffKeywords.length,
      changed: changedFieldNames(existing, updated),
    },
  });

  // Switching the assistant off is the change with the largest blast radius on this screen:
  // from that moment no customer gets an automatic reply. It earns its own ledger entry so
  // it can be found without reading every `agent.updated` payload.
  if (existing.isActive !== updated.isActive) {
    await appendAuditLog(db, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      actorMemberId: ctx.membershipId,
      actorType: 'USER',
      action: updated.isActive ? 'agent.activated' : 'agent.deactivated',
      resourceType: 'AIAgent',
      resourceId: updated.id,
      metadata: { name: updated.name },
    });
  }

  return toView(updated);
}

/**
 * The names of the fields this save actually altered.
 *
 * Recorded instead of before/after values so the ledger stays small and free of the owner's
 * long-form text, while still answering the question an audit trail is read for: what did
 * this person change?
 */
function changedFieldNames(
  before: AIAgentWithInstructionsRow,
  after: AIAgentWithInstructionsRow,
): string[] {
  const changed: string[] = [];

  if (before.name !== after.name) changed.push('name');
  if (before.role !== after.role) changed.push('role');
  if (before.tone !== after.tone) changed.push('tone');
  if (before.persona !== after.persona) changed.push('persona');
  if (before.greeting !== after.greeting) changed.push('greeting');
  if (before.customInstructions !== after.customInstructions) {
    changed.push('customInstructions');
  }
  if (before.temperature !== after.temperature) changed.push('temperature');
  if (before.maxOutputTokens !== after.maxOutputTokens) changed.push('maxOutputTokens');
  if (before.isActive !== after.isActive) changed.push('isActive');
  if (
    before.handoffKeywords.length !== after.handoffKeywords.length ||
    before.handoffKeywords.some((keyword, index) => keyword !== after.handoffKeywords[index])
  ) {
    changed.push('handoffKeywords');
  }

  return changed;
}
