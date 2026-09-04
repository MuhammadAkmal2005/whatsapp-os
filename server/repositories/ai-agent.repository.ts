/**
 * AI Agent repository.
 *
 * Scopes every database operation to `workspaceId`.
 * Manages AIAgent rows, instructions, and performance counters.
 */

import 'server-only';

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

export async function findAgentById(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<AIAgentWithInstructionsRow | null> {
  const row = await db.aIAgent.findFirst({
    where: { id, workspaceId },
    select: {
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
    },
  });

  if (!row) return null;
  return assertBelongsToWorkspace(row, workspaceId, 'AIAgent') as AIAgentWithInstructionsRow;
}

export async function findDefaultOrActiveAgent(
  db: Db,
  workspaceId: string,
): Promise<AIAgentWithInstructionsRow | null> {
  // First try default active agent
  let row = await db.aIAgent.findFirst({
    where: { workspaceId, isActive: true, isDefault: true },
    select: {
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
    },
  });

  // If no default active, take first active
  if (!row) {
    row = await db.aIAgent.findFirst({
      where: { workspaceId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: {
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
      },
    });
  }

  // Fallback to any agent
  if (!row) {
    row = await db.aIAgent.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
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
      },
    });
  }

  if (!row) return null;
  return assertBelongsToWorkspace(row, workspaceId, 'AIAgent') as AIAgentWithInstructionsRow;
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
