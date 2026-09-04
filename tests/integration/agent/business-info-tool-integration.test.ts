/**
 * `get_business_info` against a real database.
 *
 * Two things matter here and nothing else does. First, that the tool returns the
 * business's own configured facts, so the agent can answer "delivery kitna hai?" instead
 * of handing off. Second, that it returns *only* that business's facts and only the
 * customer-facing ones — the workspace comes from the server-built context and the
 * repository's `select` decides what is loadable at all.
 */

import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/db/prisma';
import type { SupportedCurrency } from '@/config/constants';
import { createAITenantContext } from '@/server/services/agent/context';
import { getBusinessInfoTool } from '@/server/services/agent/tools/impl/get-business-info.tool';
import type { BusinessInfoResultDTO } from '@/server/services/agent/tools/impl/get-business-info.tool';
import { ToolRegistry } from '@/server/services/agent/tools/registry';
import {
  createBusinessProfileFixture,
  createContactFixture,
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';

type ToolResult = Awaited<ReturnType<typeof getBusinessInfoTool.handler>>;

/** Narrows away the `NOT_CONFIGURED` branch, reporting the server's own message if it fires. */
function expectProfile(result: ToolResult): BusinessInfoResultDTO {
  if ('error' in result) {
    throw new Error(`get_business_info failed: ${result.error} — ${result.message}`);
  }
  return result;
}

/**
 * One agent answering one conversation, which is the only situation this tool runs in.
 * The capability defaults to the one the tool requires; a test that wants to prove the
 * refusal passes something else.
 */
async function contextFor(
  workspaceId: string,
  options: { currency?: SupportedCurrency; capabilities?: string[] } = {},
) {
  const agent = await prisma.aIAgent.create({
    data: { workspaceId, name: 'Info Agent', model: 'gpt-4o-mini' },
  });
  const contact = await createContactFixture(workspaceId);
  const conversation = await prisma.conversation.create({
    data: { workspaceId, contactId: contact.id, status: 'OPEN' },
  });

  return createAITenantContext({
    workspaceId,
    agentId: agent.id,
    conversationId: conversation.id,
    messageId: randomUUID(),
    executionId: randomUUID(),
    capabilities: options.capabilities ?? ['business:read'],
    currency: options.currency ?? 'PKR',
  });
}

describe('get_business_info tool', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns the money settings the owner configured, as integers and as strings', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createBusinessProfileFixture(workspaceId, {
      deliveryFeeMinor: 25_000,
      freeDeliveryThresholdMinor: 300_000,
      taxRateBps: 1700,
      paymentMethods: ['COD', 'BANK_TRANSFER', 'EASYPAISA'],
    });

    const info = expectProfile(await getBusinessInfoTool.handler(await contextFor(workspaceId), {}));

    expect(info.currency).toBe('PKR');
    expect(info.deliveryFeeMinor).toBe(25_000);
    expect(info.freeDeliveryThresholdMinor).toBe(300_000);
    expect(info.taxRateBps).toBe(1700);
    expect(info.paymentMethods).toEqual(['COD', 'BANK_TRANSFER', 'EASYPAISA']);

    // The strings exist so the model quotes "Rs. 250" rather than dividing 25000 itself.
    expect(info.deliveryFeeDisplay).toBe('Rs. 250');
    expect(info.freeDeliveryThresholdDisplay).toBe('Rs. 3,000');
    expect(info.taxRateDisplay).toBe('17%');
  });

  it('returns the policies and support details a customer asks about', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createBusinessProfileFixture(workspaceId, {
      legalName: 'Akmal Fashion House',
      description: 'Unstitched and ready-to-wear lawn, shipped nationwide.',
      city: 'Lahore',
      supportPhone: '+923001234567',
      supportEmail: 'help@example.test',
      website: 'https://example.test',
      shippingPolicy: 'Orders ship within 2 working days via Leopards Courier.',
      returnPolicy: 'Exchange within 7 days if the tags are intact.',
    });

    const info = expectProfile(await getBusinessInfoTool.handler(await contextFor(workspaceId), {}));

    expect(info.legalName).toBe('Akmal Fashion House');
    expect(info.city).toBe('Lahore');
    expect(info.country).toBe('PK');
    expect(info.supportPhone).toBe('+923001234567');
    expect(info.shippingPolicy).toContain('2 working days');
    expect(info.returnPolicy).toContain('7 days');
  });

  it('distinguishes an unset free-delivery threshold from a threshold of zero', async () => {
    const { workspaceId: withoutThreshold } = await createWorkspaceFixture();
    await createBusinessProfileFixture(withoutThreshold, {
      deliveryFeeMinor: 25_000,
      freeDeliveryThresholdMinor: null,
    });

    const unset = expectProfile(
      await getBusinessInfoTool.handler(await contextFor(withoutThreshold), {}),
    );
    expect(unset.freeDeliveryThresholdMinor).toBeUndefined();
    expect(unset.freeDeliveryThresholdDisplay).toBeUndefined();

    const { workspaceId: withZero } = await createWorkspaceFixture();
    await createBusinessProfileFixture(withZero, {
      deliveryFeeMinor: 25_000,
      freeDeliveryThresholdMinor: 0,
    });

    // Zero is a real answer — "delivery is free on anything" — and must not read as absent.
    const zero = expectProfile(await getBusinessInfoTool.handler(await contextFor(withZero), {}));
    expect(zero.freeDeliveryThresholdMinor).toBe(0);
    expect(zero.freeDeliveryThresholdDisplay).toBe('Rs. 0');
  });

  it('returns only the days the owner actually filled in, in week order', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createBusinessProfileFixture(workspaceId, {
      businessHours: {
        monday: { open: '11:00', close: '21:00', closed: false },
        friday: { open: '15:00', close: '22:00', closed: false },
        sunday: { closed: true },
      },
    });

    const info = expectProfile(await getBusinessInfoTool.handler(await contextFor(workspaceId), {}));

    expect(info.businessHours?.map((entry) => entry.day)).toEqual(['monday', 'friday', 'sunday']);
    expect(info.businessHours?.[0]).toEqual({
      day: 'monday',
      open: '11:00',
      close: '21:00',
      closed: false,
    });
    expect(info.businessHours?.[2]?.closed).toBe(true);
  });

  it('ignores a malformed businessHours column instead of inventing hours', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createBusinessProfileFixture(workspaceId, {
      businessHours: { monday: 'open all day' },
    });

    const info = expectProfile(await getBusinessInfoTool.handler(await contextFor(workspaceId), {}));

    // A shape the validator does not recognise is not hours. Saying nothing is right;
    // guessing at "open all day" is how the agent tells a customer to come at 3am.
    expect(info.businessHours).toBeUndefined();
  });

  it('never returns the private fields, even when they are set', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createBusinessProfileFixture(workspaceId, {
      addressLine1: 'House 42, Street 7, DHA Phase 5',
      privacyPolicy: 'Internal privacy policy text.',
    });

    const info = expectProfile(await getBusinessInfoTool.handler(await contextFor(workspaceId), {}));

    // Pakistani online sellers frequently work from home, so the street address is not a
    // customer-facing fact. It is not filtered here — the repository never loads it.
    for (const field of [
      'addressLine1',
      'addressLine2',
      'privacyPolicy',
      'logoStorageKey',
      'id',
      'workspaceId',
      'createdAt',
      'updatedAt',
    ]) {
      expect(info).not.toHaveProperty(field);
    }
    expect(JSON.stringify(info)).not.toContain('DHA Phase 5');
  });

  it('reports NOT_CONFIGURED rather than defaults when there is no profile row', async () => {
    const { workspaceId } = await createWorkspaceFixture();

    const result = await getBusinessInfoTool.handler(await contextFor(workspaceId), {});

    // The column defaults would read as "delivery is free and there is no tax", which is
    // a fabrication dressed as data. The agent has to hand off instead.
    if (!('error' in result)) throw new Error('expected NOT_CONFIGURED');
    expect(result.error).toBe('NOT_CONFIGURED');
    expect(result.message).toContain('hand the conversation to a person');
  });

  it('returns each workspace its own settings and never the other tenant\'s', async () => {
    const lahore = await createWorkspaceFixture({ name: 'Lahore Shop' });
    const dubai = await createWorkspaceFixture({ name: 'Dubai Shop', currency: 'AED' });

    await createBusinessProfileFixture(lahore.workspaceId, {
      legalName: 'Lahore Shop',
      deliveryFeeMinor: 25_000,
      taxRateBps: 1700,
      shippingPolicy: 'Nationwide within Pakistan.',
    });
    await createBusinessProfileFixture(dubai.workspaceId, {
      legalName: 'Dubai Shop',
      country: 'AE',
      deliveryFeeMinor: 1_500,
      taxRateBps: 500,
      shippingPolicy: 'Same-day inside Dubai.',
    });

    const lahoreCtx = await contextFor(lahore.workspaceId);
    const dubaiCtx = await contextFor(dubai.workspaceId, { currency: 'AED' });

    const lahoreInfo = expectProfile(await getBusinessInfoTool.handler(lahoreCtx, {}));
    const dubaiInfo = expectProfile(await getBusinessInfoTool.handler(dubaiCtx, {}));

    expect(lahoreInfo.legalName).toBe('Lahore Shop');
    expect(lahoreInfo.deliveryFeeMinor).toBe(25_000);
    expect(lahoreInfo.taxRateBps).toBe(1700);
    expect(lahoreInfo.currency).toBe('PKR');
    expect(lahoreInfo.shippingPolicy).toBe('Nationwide within Pakistan.');

    expect(dubaiInfo.legalName).toBe('Dubai Shop');
    expect(dubaiInfo.deliveryFeeMinor).toBe(1_500);
    expect(dubaiInfo.taxRateBps).toBe(500);
    expect(dubaiInfo.currency).toBe('AED');
    expect(dubaiInfo.country).toBe('AE');
    expect(dubaiInfo.shippingPolicy).toBe('Same-day inside Dubai.');

    // Neither answer contains any part of the other business's record.
    expect(JSON.stringify(lahoreInfo)).not.toContain('Dubai');
    expect(JSON.stringify(dubaiInfo)).not.toContain('Lahore');
  });

  it('refuses to run for an agent that was not granted business:read', async () => {
    const { workspaceId } = await createWorkspaceFixture();
    await createBusinessProfileFixture(workspaceId, { deliveryFeeMinor: 25_000 });

    const registry = new ToolRegistry().register(getBusinessInfoTool);
    const ctx = await contextFor(workspaceId, { capabilities: ['products:read'] });

    const auth = registry.authorize(ctx, 'get_business_info');
    expect(auth.authorized).toBe(false);
    expect(auth.reason).toContain('lacks required capability "business:read"');

    // And the tool is invisible to the model in the first place: the runtime only sends
    // the definitions the granted capabilities cover.
    expect(registry.getDefinitionsForCapabilities(ctx.capabilities)).toEqual([]);
  });
});
