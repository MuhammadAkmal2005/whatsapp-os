/**
 * Agent resolution.
 *
 * Two lookups over the same table that must not be collapsed into one. The runtime asks "who
 * may reply to a customer right now"; the configuration screen asks "what is this workspace's
 * assistant". The first has to refuse an agent that is switched off. The second has to return
 * it, because an owner who switched the assistant off must be able to find it and switch it
 * back on.
 *
 * The inactive cases are regression tests. A third "any agent" tier used to exist in the
 * runtime's resolver, and it meant a workspace could deliberately switch its assistant off in
 * settings and still have it answering customers — the most surprising thing a switch can do.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/db/prisma';
import {
  ensureDefaultAgent,
  findConfigurableAgent,
  findDefaultOrActiveAgent,
} from '@/server/repositories/ai-agent.repository';

import { createAgentFixture, createWorkspaceFixture, resetDatabase } from '../fixtures';

/**
 * What workspace provisioning passes. `model` is required rather than defaulted because the
 * column's default is an OpenAI identifier and no OpenAI adapter is wired.
 */
const PROVISIONED = { name: 'AI Assistant', model: 'mock-model' };

describe('Agent resolution', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('A. resolves the active default agent', async () => {
    const ws = await createWorkspaceFixture();
    const preferred = await createAgentFixture(ws.workspaceId, {
      name: 'Sana',
      isActive: true,
      isDefault: true,
    });
    // A second active agent, so this asserts the default was preferred rather than that there
    // was only ever one candidate.
    await createAgentFixture(ws.workspaceId, { name: 'Bilal', isActive: true, isDefault: false });

    const resolved = await findDefaultOrActiveAgent(prisma, ws.workspaceId);

    expect(resolved?.id).toBe(preferred.id);
    expect(resolved?.name).toBe('Sana');
  });

  it('B. falls back to an active non-default agent when no default is active', async () => {
    const ws = await createWorkspaceFixture();
    const fallback = await createAgentFixture(ws.workspaceId, {
      name: 'Bilal',
      isActive: true,
      isDefault: false,
    });

    // A workspace that has cleared the default flag still replies.
    await expect(findDefaultOrActiveAgent(prisma, ws.workspaceId)).resolves.toMatchObject({
      id: fallback.id,
    });
  });

  it('C. skips an inactive default agent in favour of an active one', async () => {
    const ws = await createWorkspaceFixture();
    const switchedOff = await createAgentFixture(ws.workspaceId, {
      name: 'Sana',
      isActive: false,
      isDefault: true,
    });
    const answering = await createAgentFixture(ws.workspaceId, {
      name: 'Bilal',
      isActive: true,
      isDefault: false,
    });

    const resolved = await findDefaultOrActiveAgent(prisma, ws.workspaceId);

    expect(resolved?.id).toBe(answering.id);
    expect(resolved?.id).not.toBe(switchedOff.id);
  });

  it("D. resolves nothing when the workspace's only agent is switched off", async () => {
    const ws = await createWorkspaceFixture();
    await createAgentFixture(ws.workspaceId, { isActive: false, isDefault: true });

    // Null is the correct answer to "which active agent should reply?" when there is none: the
    // runtime logs `ai.agent.not_configured` and hands the conversation to a person. The old
    // third tier answered with the switched-off agent instead.
    await expect(findDefaultOrActiveAgent(prisma, ws.workspaceId)).resolves.toBeNull();
  });

  it('D. resolves nothing when every agent in the workspace is switched off', async () => {
    const ws = await createWorkspaceFixture();
    await createAgentFixture(ws.workspaceId, { name: 'Sana', isActive: false, isDefault: true });
    await createAgentFixture(ws.workspaceId, { name: 'Bilal', isActive: false, isDefault: false });

    await expect(findDefaultOrActiveAgent(prisma, ws.workspaceId)).resolves.toBeNull();
  });

  it('E. resolves nothing for a workspace with no agent at all', async () => {
    const ws = await createWorkspaceFixture();

    await expect(findDefaultOrActiveAgent(prisma, ws.workspaceId)).resolves.toBeNull();
    await expect(findConfigurableAgent(prisma, ws.workspaceId)).resolves.toBeNull();
  });

  it('E. provisions an active default agent for a workspace that has none', async () => {
    const ws = await createWorkspaceFixture();

    const { id, created } = await ensureDefaultAgent(prisma, ws.workspaceId, PROVISIONED);

    expect(created).toBe(true);
    const row = await prisma.aIAgent.findUniqueOrThrow({ where: { id } });
    // Created active, against the column's `false` default. An inactive new agent reproduces
    // exactly the failure provisioning exists to prevent: resolution finds nothing, the AI job
    // completes successfully having said nothing, and the customer is left waiting.
    expect(row.isActive).toBe(true);
    expect(row.isDefault).toBe(true);
    expect(row.model).toBe(PROVISIONED.model);
    await expect(findDefaultOrActiveAgent(prisma, ws.workspaceId)).resolves.toMatchObject({ id });
  });

  it('E. provisioning is idempotent and never revives an agent the owner switched off', async () => {
    const ws = await createWorkspaceFixture();
    const switchedOff = await createAgentFixture(ws.workspaceId, {
      isActive: false,
      isDefault: true,
    });

    const first = await ensureDefaultAgent(prisma, ws.workspaceId, PROVISIONED);
    const second = await ensureDefaultAgent(prisma, ws.workspaceId, PROVISIONED);

    // The bootstrap interaction the inactive-agent fix had to leave intact: provisioning looks
    // up *any* agent, so a workspace whose only assistant was deliberately deactivated does not
    // quietly acquire a second, active one on the next signup or migration pass.
    expect(first).toEqual({ id: switchedOff.id, created: false });
    expect(second).toEqual({ id: switchedOff.id, created: false });
    await expect(prisma.aIAgent.count({ where: { workspaceId: ws.workspaceId } })).resolves.toBe(1);
    await expect(
      prisma.aIAgent.findUniqueOrThrow({ where: { id: switchedOff.id } }),
    ).resolves.toMatchObject({ isActive: false });
    await expect(findDefaultOrActiveAgent(prisma, ws.workspaceId)).resolves.toBeNull();
  });

  it("never resolves another workspace's agent", async () => {
    const wsA = await createWorkspaceFixture({ name: 'Alpha Fabrics' });
    const wsB = await createWorkspaceFixture({ name: 'Beta Threads' });
    const agentB = await createAgentFixture(wsB.workspaceId, { name: 'Beta Assistant' });

    await expect(findDefaultOrActiveAgent(prisma, wsA.workspaceId)).resolves.toBeNull();
    await expect(findConfigurableAgent(prisma, wsA.workspaceId)).resolves.toBeNull();
    await expect(findDefaultOrActiveAgent(prisma, wsB.workspaceId)).resolves.toMatchObject({
      id: agentB.id,
    });
  });

  it('loads a switched-off agent for the configuration screen', async () => {
    const ws = await createWorkspaceFixture();
    const switchedOff = await createAgentFixture(ws.workspaceId, {
      name: 'Sana',
      isActive: false,
      isDefault: true,
    });

    // The screen has to render the switch in order to offer to switch it back on. This is the
    // one place the two lookups must disagree, and the reason they are separate functions.
    await expect(findConfigurableAgent(prisma, ws.workspaceId)).resolves.toMatchObject({
      id: switchedOff.id,
      isActive: false,
    });
    await expect(findDefaultOrActiveAgent(prisma, ws.workspaceId)).resolves.toBeNull();
  });

  it('hands the configuration screen the same agent the runtime replies with', async () => {
    const ws = await createWorkspaceFixture();
    // Created first, so preferring the default is doing the work rather than creation order.
    await createAgentFixture(ws.workspaceId, { name: 'Bilal', isActive: true, isDefault: false });
    const preferred = await createAgentFixture(ws.workspaceId, {
      name: 'Sana',
      isActive: true,
      isDefault: true,
    });

    const configurable = await findConfigurableAgent(prisma, ws.workspaceId);
    const resolved = await findDefaultOrActiveAgent(prisma, ws.workspaceId);

    // Editing one agent while a different one answers customers would be indistinguishable,
    // from the owner's side, from the settings not saving at all.
    expect(configurable?.id).toBe(preferred.id);
    expect(resolved?.id).toBe(preferred.id);
  });
});
