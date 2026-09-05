/**
 * AI Agent repository.
 *
 * Scopes every database operation to `workspaceId`.
 * Manages AIAgent rows, instructions, and performance counters.
 */

import 'server-only';

import type { AgentRole, AgentTone } from '@prisma/client';

import type { Db } from '@/db/prisma';
import { assertBelongsToWorkspace } from '@/server/tenancy/context';

export type AIAgentRow = {
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  isActive: boolean;
  isDefault: boolean;
  tone: string;
  languages: string[];
  greeting: string | null;
  persona: string | null;
  customInstructions: string | null;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  confidenceFloor: number;
  businessHoursOnly: boolean;
  handoffKeywords: string[];
  escalationRules: unknown | null;
  conversationsHandled: number;
  handoffCount: number;
  ordersCreated: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AIAgentWithInstructionsRow = AIAgentRow & {
  instructions: {
    id: string;
    title: string;
    content: string;
    position: number;
    isActive: boolean;
  }[];
};

const AGENT_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  role: true,
  isActive: true,
  isDefault: true,
  tone: true,
  languages: true,
  greeting: true,
  persona: true,
  customInstructions: true,
  model: true,
  temperature: true,
  maxOutputTokens: true,
  confidenceFloor: true,
  businessHoursOnly: true,
  handoffKeywords: true,
  escalationRules: true,
  conversationsHandled: true,
  handoffCount: true,
  ordersCreated: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The agent plus its ordered, enabled instruction rows.
 *
 * One constant rather than the same nested `select` spelled out at each call site: every
 * reader in this file wants exactly this shape, and a reader that quietly drifted — say,
 * one that forgot `where: { isActive: true }` — would feed disabled guidelines into the
 * system prompt without anything failing.
 */
const AGENT_WITH_INSTRUCTIONS_SELECT = {
  ...AGENT_SELECT,
  instructions: {
    where: { isActive: true },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      title: true,
      content: true,
      position: true,
      isActive: true,
    },
  },
} as const;

export async function findAgentById(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<AIAgentWithInstructionsRow | null> {
  const row = await db.aIAgent.findFirst({
    where: { id, workspaceId },
    select: AGENT_WITH_INSTRUCTIONS_SELECT,
  });

  if (!row) return null;
  return assertBelongsToWorkspace(row, workspaceId, 'AIAgent') as AIAgentWithInstructionsRow;
}

/**
 * The agent that answers a customer automatically, or null.
 *
 * Two tiers, both requiring `isActive`. The workspace's default agent is preferred; any
 * other active agent is accepted as a fallback so that a workspace which has cleared the
 * default flag still replies.
 *
 * There is deliberately no third "any agent" tier. One used to exist, and it meant an
 * owner who switched their assistant off in settings still had it answering customers —
 * the single most surprising thing a switch can do. Returning null is the correct answer
 * to "which active agent should reply?" when there is none: the runtime logs
 * `ai.agent.not_configured` and hands the conversation to a person.
 *
 * The configuration screen needs the opposite behaviour — it must load the switched-off
 * agent in order to offer the switch — so that lookup lives in `findConfigurableAgent`
 * below rather than being folded back in here.
 */
export async function findDefaultOrActiveAgent(
  db: Db,
  workspaceId: string,
): Promise<AIAgentWithInstructionsRow | null> {
  // First try default active agent
  let row = await db.aIAgent.findFirst({
    where: { workspaceId, isActive: true, isDefault: true },
    select: AGENT_WITH_INSTRUCTIONS_SELECT,
  });

  // If no default active, take first active
  if (!row) {
    row = await db.aIAgent.findFirst({
      where: { workspaceId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: AGENT_WITH_INSTRUCTIONS_SELECT,
    });
  }

  if (!row) return null;
  return assertBelongsToWorkspace(row, workspaceId, 'AIAgent') as AIAgentWithInstructionsRow;
}

/**
 * The agent the configuration screen edits, active or not.
 *
 * Ordered by creation so that a workspace which somehow holds more than one row always
 * resolves to the same one, and preferring the default so that the row this returns is
 * the row `findDefaultOrActiveAgent` will pick once it is active.
 *
 * Separate from `findDefaultOrActiveAgent` on purpose: that function answers "who may
 * reply to a customer right now", this one answers "what is this workspace's assistant".
 * Collapsing them is how an inactive agent ends up replying.
 */
export async function findConfigurableAgent(
  db: Db,
  workspaceId: string,
): Promise<AIAgentWithInstructionsRow | null> {
  const row = await db.aIAgent.findFirst({
    where: { workspaceId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: AGENT_WITH_INSTRUCTIONS_SELECT,
  });

  if (!row) return null;
  return assertBelongsToWorkspace(row, workspaceId, 'AIAgent') as AIAgentWithInstructionsRow;
}

/**
 * The fields a shop owner may write, named one by one.
 *
 * The type exists so the update statement below can be built from an explicit list rather
 * than from a spread of whatever the caller passed. A validated object still carries
 * whatever else its source put on it at runtime; naming the columns here means the
 * database boundary enforces the same allow-list the Zod schema does, and a new column
 * added to the model does not silently become writable from a browser.
 */
export type AgentConfigUpdateFields = {
  name: string;
  role: AgentRole;
  tone: AgentTone;
  persona: string | null;
  greeting: string | null;
  customInstructions: string | null;
  handoffKeywords: string[];
  temperature: number;
  maxOutputTokens: number;
  isActive: boolean;
};

/**
 * Writes the owner's configuration, scoped to the workspace.
 *
 * `updateMany` with both `id` and `workspaceId` in the `where` clause, so an id belonging
 * to another tenant matches no row and updates nothing rather than being read, checked
 * and rejected. The returned count lets the service tell "not yours" from "saved", and
 * the row is read back afterwards so the screen renders what the database now holds
 * rather than what the form hoped it would.
 *
 * `role` and `tone` carry Prisma's own enum types, so the validation schema's string
 * unions are checked against the database's enums at compile time — a role the column
 * cannot hold fails to build rather than failing at the first customer message.
 */
export async function updateAgentConfig(
  db: Db,
  workspaceId: string,
  agentId: string,
  fields: AgentConfigUpdateFields,
): Promise<AIAgentWithInstructionsRow | null> {
  const result = await db.aIAgent.updateMany({
    where: { id: agentId, workspaceId },
    data: {
      name: fields.name,
      role: fields.role,
      tone: fields.tone,
      persona: fields.persona,
      greeting: fields.greeting,
      customInstructions: fields.customInstructions,
      handoffKeywords: fields.handoffKeywords,
      temperature: fields.temperature,
      maxOutputTokens: fields.maxOutputTokens,
      isActive: fields.isActive,
    },
  });

  if (result.count === 0) return null;
  return findAgentById(db, workspaceId, agentId);
}

export type EnsureDefaultAgentFields = {
  name: string;
  /** Resolved by the caller from configuration — see the note below. */
  model: string;
  greeting?: string | null;
};

/**
 * The workspace's default agent, created if it has none.
 *
 * Idempotent by lookup rather than by unique constraint. The schema puts no unique
 * index on `isDefault` because a workspace will eventually run several agents —
 * sales, support, reception — so the condition worth checking is "this workspace
 * already has an agent", not "this exact row exists".
 *
 * Created `isActive: true`, against the schema's `false` default. An inactive agent
 * reproduces exactly the bug this function exists to remove: `findDefaultOrActiveAgent`
 * returns nothing, and the AI job completes successfully having said nothing to the
 * customer. Nothing is lost by activating it, because the controls that matter live
 * elsewhere — `Conversation.aiEnabled` is the per-thread kill switch, human takeover
 * overrides it, and the runtime's grounding rules make an agent with no knowledge
 * decline and hand off rather than invent.
 *
 * `model` is a required field rather than a default because the schema's default is
 * an OpenAI model name and the runtime passes `agent.model` to whichever provider is
 * configured. Baking a provider's model name into a row that a different provider
 * will read is a failure at the first customer message.
 */
export async function ensureDefaultAgent(
  db: Db,
  workspaceId: string,
  fields: EnsureDefaultAgentFields,
): Promise<{ id: string; created: boolean }> {
  // Any agent, not just an active or default one. A workspace whose only agent was
  // deliberately deactivated should not quietly acquire a second, active one.
  const existing = await db.aIAgent.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (existing) {
    return { id: existing.id, created: false };
  }

  const agent = await db.aIAgent.create({
    data: {
      workspaceId,
      name: fields.name,
      model: fields.model,
      greeting: fields.greeting ?? null,
      isActive: true,
      isDefault: true,
    },
    select: { id: true },
  });

  return { id: agent.id, created: true };
}

export async function incrementAgentCounters(
  db: Db,
  workspaceId: string,
  agentId: string,
  increments: {
    conversationsHandled?: number;
    handoffCount?: number;
    ordersCreated?: number;
  },
): Promise<void> {
  await db.aIAgent.updateMany({
    where: { id: agentId, workspaceId },
    data: {
      ...(increments.conversationsHandled
        ? { conversationsHandled: { increment: increments.conversationsHandled } }
        : {}),
      ...(increments.handoffCount
        ? { handoffCount: { increment: increments.handoffCount } }
        : {}),
      ...(increments.ordersCreated
        ? { ordersCreated: { increment: increments.ordersCreated } }
        : {}),
    },
  });
}
