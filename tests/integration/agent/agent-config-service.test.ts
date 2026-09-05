/**
 * Agent configuration service.
 *
 * The business rules behind the `/agent` screen, against a real database: who may read the
 * configuration, who may change it, which columns a save is allowed to touch, and what the
 * audit ledger records afterwards.
 *
 * The authorization and isolation cases are the reason this file exists. The service resolves
 * the agent from the tenant context rather than from anything the browser sends, so there is
 * no id for a form field to substitute — but "there is no way to pass the wrong id" is a claim
 * worth a test rather than a comment.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/db/prisma';
import { ForbiddenError, NotFoundError } from '@/server/errors';
import type { WorkspaceRole } from '@/server/authz/permissions';
import {
  getAgentConfig,
  provisionAgentConfig,
  updateAgentConfiguration,
} from '@/server/services/agent/agent-config.service';
import type { TenantContext } from '@/server/tenancy/context';
import {
  updateAgentConfigSchema,
  type UpdateAgentConfigInput,
} from '@/server/validation/agent';

import {
  createAgentFixture,
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
  type WorkspaceFixture,
} from '../fixtures';

/**
 * A valid configuration, parsed through the real schema rather than hand-built, so these
 * tests exercise the same object the server action hands over — normalisation included.
 */
function configInput(overrides: Record<string, unknown> = {}): UpdateAgentConfigInput {
  return updateAgentConfigSchema.parse({
    name: 'Sana',
    role: 'SALES_SUPPORT',
    tone: 'FRIENDLY',
    persona: 'Warm and brief, never pushy.',
    greeting: 'Assalam o Alaikum! Kya poochna chahte hain?',
    customInstructions: 'Karachi delivery is next day. COD is available.',
    handoffKeywords: 'Manager\ncomplaint',
    temperature: '0.5',
    maxOutputTokens: '800',
    isActive: 'true',
    ...overrides,
  });
}

/** A second member of the same workspace, holding whichever role the test is about. */
async function contextForRole(
  ws: WorkspaceFixture,
  role: WorkspaceRole,
): Promise<TenantContext> {
  const member = await createMemberFixture(ws.workspaceId, role, { name: 'Hira Aslam' });

  return tenantContextFor({
    workspaceId: ws.workspaceId,
    workspaceSlug: ws.workspaceSlug,
    workspaceName: ws.context.workspaceName,
    currency: ws.context.currency,
    userId: member.userId,
    userName: member.name,
    userEmail: member.email,
    membershipId: member.membershipId,
    role,
  });
}

/** The audit payload as an object, so an assertion can read it without reaching for `any`. */
function metadataOf(entry: { metadata: Prisma.JsonValue }): Record<string, unknown> {
  const { metadata } = entry;
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('expected the audit entry to carry an object payload');
  }
  return metadata;
}

async function auditActions(workspaceId: string): Promise<string[]> {
  const entries = await prisma.auditLog.findMany({
    where: { workspaceId, resourceType: 'AIAgent' },
    orderBy: { createdAt: 'asc' },
    select: { action: true },
  });
  return entries.map((entry) => entry.action);
}

describe('Agent configuration service', () => {
  let ws: WorkspaceFixture;

  beforeEach(async () => {
    await resetDatabase();
    ws = await createWorkspaceFixture({ name: 'Akmal Fashion' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reads the workspace assistant as configured', async () => {
    const agent = await createAgentFixture(ws.workspaceId, {
      name: 'Sana',
      role: 'SUPPORT',
      tone: 'PROFESSIONAL',
      persona: 'Calm and precise.',
      handoffKeywords: ['manager'],
      temperature: 0.4,
      maxOutputTokens: 700,
    });

    const view = await getAgentConfig(ws.context);

    expect(view).toMatchObject({
      id: agent.id,
      name: 'Sana',
      role: 'SUPPORT',
      tone: 'PROFESSIONAL',
      persona: 'Calm and precise.',
      handoffKeywords: ['manager'],
      temperature: 0.4,
      maxOutputTokens: 700,
      isActive: true,
    });
  });

  it('reads a switched-off assistant, so the owner can switch it back on', async () => {
    await createAgentFixture(ws.workspaceId, { isActive: false });

    await expect(getAgentConfig(ws.context)).resolves.toMatchObject({ isActive: false });
  });

  it('returns null for a workspace with no assistant instead of creating one', async () => {
    // Null is a real state, not an error: a workspace provisioned before the agent bootstrap
    // existed has no row. The screen renders that honestly and offers to create one, rather
    // than a page render quietly writing to the database.
    await expect(getAgentConfig(ws.context)).resolves.toBeNull();
    await expect(prisma.aIAgent.count({ where: { workspaceId: ws.workspaceId } })).resolves.toBe(0);
  });

  it('lets a viewer read the configuration but not change it', async () => {
    await createAgentFixture(ws.workspaceId, { name: 'Sana' });
    const viewer = await contextForRole(ws, 'VIEWER');

    // `agent:read` reaches every role, so anyone on the team can see how the assistant is set
    // up. `agent:update` starts at manager.
    await expect(getAgentConfig(viewer)).resolves.toMatchObject({ name: 'Sana' });
    await expect(updateAgentConfiguration(viewer, configInput({ name: 'Renamed' }))).rejects.toThrow(
      ForbiddenError,
    );

    // The denial is not merely reported — nothing was written.
    await expect(getAgentConfig(ws.context)).resolves.toMatchObject({ name: 'Sana' });
    await expect(auditActions(ws.workspaceId)).resolves.toEqual([]);
  });

  it('persists every field the screen exposes', async () => {
    await createAgentFixture(ws.workspaceId, { name: 'Old Name', role: 'RECEPTIONIST' });

    const saved = await updateAgentConfiguration(
      ws.context,
      configInput({
        name: 'Ayesha',
        role: 'ORDER_TAKER',
        tone: 'CONCISE',
        persona: 'Brisk and helpful.',
        greeting: 'Assalam o Alaikum!',
        customInstructions: 'Lahore delivery takes two days.',
        handoffKeywords: 'Manager\nmanager\nshikayat',
        temperature: '0.7',
        maxOutputTokens: '900',
      }),
    );

    expect(saved).toMatchObject({
      name: 'Ayesha',
      role: 'ORDER_TAKER',
      tone: 'CONCISE',
      persona: 'Brisk and helpful.',
      greeting: 'Assalam o Alaikum!',
      customInstructions: 'Lahore delivery takes two days.',
      // Lower-cased and de-duplicated on the way in, because the runtime lower-cases the
      // inbound message before comparing.
      handoffKeywords: ['manager', 'shikayat'],
      temperature: 0.7,
      maxOutputTokens: 900,
    });

    // Read back from the database rather than trusting the value the service returned.
    await expect(getAgentConfig(ws.context)).resolves.toMatchObject({
      name: 'Ayesha',
      role: 'ORDER_TAKER',
      handoffKeywords: ['manager', 'shikayat'],
    });
  });

  it('clears optional text the owner emptied', async () => {
    await createAgentFixture(ws.workspaceId, {
      persona: 'Something the owner wrote once.',
      greeting: 'An old greeting.',
      customInstructions: 'Old instructions.',
    });

    const saved = await updateAgentConfiguration(
      ws.context,
      configInput({ persona: '', greeting: '  ', customInstructions: '' }),
    );

    expect(saved.persona).toBeNull();
    expect(saved.greeting).toBeNull();
    expect(saved.customInstructions).toBeNull();
  });

  it('leaves the columns the browser has no business touching exactly as they were', async () => {
    const agent = await createAgentFixture(ws.workspaceId, { model: 'mock-model' });
    await prisma.aIAgent.update({
      where: { id: agent.id },
      data: { conversationsHandled: 12, handoffCount: 3, ordersCreated: 5, confidenceFloor: 0.6 },
    });
    const before = await prisma.aIAgent.findUniqueOrThrow({ where: { id: agent.id } });

    await updateAgentConfiguration(ws.context, configInput({ name: 'Ayesha' }));

    const after = await prisma.aIAgent.findUniqueOrThrow({ where: { id: agent.id } });
    // The model identifier is stamped by the deployment, the counters are the runtime's own
    // tally, and the rest are stored but unread. A save from the form touches none of them.
    expect(after.model).toBe(before.model);
    expect(after.workspaceId).toBe(before.workspaceId);
    expect(after.isDefault).toBe(before.isDefault);
    expect(after.conversationsHandled).toBe(12);
    expect(after.handoffCount).toBe(3);
    expect(after.ordersCreated).toBe(5);
    expect(after.confidenceFloor).toBe(0.6);
    expect(after.businessHoursOnly).toBe(before.businessHoursOnly);
    expect(after.languages).toEqual(before.languages);
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
  });

  it('refuses to save for a workspace that has no assistant', async () => {
    await expect(updateAgentConfiguration(ws.context, configInput())).rejects.toThrow(NotFoundError);
  });

  it('cannot reach another workspace assistant', async () => {
    const other = await createWorkspaceFixture({ name: 'Beta Threads' });
    const ourAgent = await createAgentFixture(ws.workspaceId, { name: 'Sana' });
    const theirAgent = await createAgentFixture(other.workspaceId, { name: 'Beta Assistant' });

    // Each context resolves its own agent, so a save in one workspace is invisible in the other.
    await updateAgentConfiguration(ws.context, configInput({ name: 'Ayesha' }));

    await expect(
      prisma.aIAgent.findUniqueOrThrow({ where: { id: ourAgent.id } }),
    ).resolves.toMatchObject({ name: 'Ayesha' });
    await expect(
      prisma.aIAgent.findUniqueOrThrow({ where: { id: theirAgent.id } }),
    ).resolves.toMatchObject({ name: 'Beta Assistant' });
    await expect(getAgentConfig(other.context)).resolves.toMatchObject({
      id: theirAgent.id,
      name: 'Beta Assistant',
    });
    await expect(auditActions(other.workspaceId)).resolves.toEqual([]);
  });

  it('records what changed, and not the owner long-form text', async () => {
    const agent = await createAgentFixture(ws.workspaceId, { name: 'Sana', temperature: 0.3 });

    await updateAgentConfiguration(
      ws.context,
      configInput({ name: 'Ayesha', temperature: '0.7', persona: 'A brand new persona.' }),
    );

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: ws.workspaceId, action: 'agent.updated' },
    });
    expect(entry.resourceType).toBe('AIAgent');
    expect(entry.resourceId).toBe(agent.id);
    expect(entry.actorUserId).toBe(ws.ownerUserId);
    expect(entry.actorMemberId).toBe(ws.ownerMembershipId);

    const metadata = metadataOf(entry);
    expect(metadata.changed).toEqual(
      expect.arrayContaining(['name', 'temperature', 'persona', 'handoffKeywords']),
    );
    // The ledger answers "who changed the assistant, when, and did they switch it off". The
    // persona and the instructions are the owner's own words and can run to pages, so the
    // payload names the fields that moved rather than quoting them.
    expect(Object.keys(metadata)).not.toContain('persona');
    expect(Object.keys(metadata)).not.toContain('customInstructions');
    expect(metadata.handoffKeywordCount).toBe(2);
  });

  it('gives switching the assistant off its own ledger entry', async () => {
    await createAgentFixture(ws.workspaceId, { isActive: true });

    await updateAgentConfiguration(ws.context, configInput({ isActive: 'false' }));

    // From that moment no customer gets an automatic reply, which is the largest blast radius
    // on the screen. It earns an entry that can be found without reading every update payload.
    await expect(auditActions(ws.workspaceId)).resolves.toEqual([
      'agent.updated',
      'agent.deactivated',
    ]);
    await expect(getAgentConfig(ws.context)).resolves.toMatchObject({ isActive: false });
  });

  it('records switching the assistant back on', async () => {
    await createAgentFixture(ws.workspaceId, { isActive: false });

    await updateAgentConfiguration(ws.context, configInput({ isActive: 'true' }));

    await expect(auditActions(ws.workspaceId)).resolves.toEqual([
      'agent.updated',
      'agent.activated',
    ]);
  });

  it('writes no activation entry when the switch did not move', async () => {
    await createAgentFixture(ws.workspaceId, { isActive: true });

    await updateAgentConfiguration(ws.context, configInput({ name: 'Ayesha', isActive: 'true' }));

    await expect(auditActions(ws.workspaceId)).resolves.toEqual(['agent.updated']);
  });

  it('creates the assistant for a workspace that has none, and records it', async () => {
    const created = await provisionAgentConfig(ws.context);

    expect(created.isActive).toBe(true);
    expect(created.isDefault).toBe(true);
    expect(created.name.length).toBeGreaterThan(0);
    await expect(auditActions(ws.workspaceId)).resolves.toEqual(['agent.created']);
  });

  it('provisions at most one assistant however many times it is asked', async () => {
    const first = await provisionAgentConfig(ws.context);
    const second = await provisionAgentConfig(ws.context);

    // Idempotent by lookup, so a double-press, a retry, or two members pressing the button at
    // once cannot produce a second assistant or a second default.
    expect(second.id).toBe(first.id);
    await expect(prisma.aIAgent.count({ where: { workspaceId: ws.workspaceId } })).resolves.toBe(1);
    await expect(auditActions(ws.workspaceId)).resolves.toEqual(['agent.created']);
  });

  it('returns the existing assistant rather than replacing it', async () => {
    const existing = await createAgentFixture(ws.workspaceId, {
      name: 'Sana',
      isActive: false,
      persona: 'Something the owner wrote.',
    });

    const view = await provisionAgentConfig(ws.context);

    expect(view).toMatchObject({
      id: existing.id,
      name: 'Sana',
      isActive: false,
      persona: 'Something the owner wrote.',
    });
    await expect(auditActions(ws.workspaceId)).resolves.toEqual([]);
  });

  it('refuses to provision for a viewer', async () => {
    const viewer = await contextForRole(ws, 'VIEWER');

    await expect(provisionAgentConfig(viewer)).rejects.toThrow(ForbiddenError);
    await expect(prisma.aIAgent.count({ where: { workspaceId: ws.workspaceId } })).resolves.toBe(0);
  });
});
