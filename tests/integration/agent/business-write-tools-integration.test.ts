import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';
import type { SupportedCurrency } from '@/config/constants';
import { prisma } from '@/db/prisma';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { createAITenantContext } from '@/server/services/agent/context';
import {
  createOrderTool,
  type CreateOrderSuccessDTO,
  type CreateOrderToolResult,
} from '@/server/services/agent/tools/impl/create-order.tool';
import { defaultToolRegistry, ToolRegistry } from '@/server/services/agent/tools/registry';
import {
  createBusinessProfileFixture,
  createContactFixture,
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';

/**
 * Narrows `create_order`'s result union to the success branch.
 *
 * The tool declares its output as `CreateOrderSuccessDTO | { error, message }` rather than
 * `any`, which means a test cannot read `orderNumber` without first establishing which
 * branch it got. Failing here surfaces the server's own error string, so a broken pricing
 * path reads as "insufficient stock" rather than as `undefined` three assertions later.
 */
function expectOrderCreated(result: CreateOrderToolResult): CreateOrderSuccessDTO {
  if (!('success' in result)) {
    throw new Error(`create_order failed: ${result.error} — ${result.message}`);
  }
  return result;
}

/** The mirror of the above, for the paths that are supposed to fail. */
function expectOrderRejected(result: CreateOrderToolResult): { error: string; message: string } {
  if ('success' in result) {
    throw new Error(`create_order unexpectedly succeeded: ${result.orderNumber}`);
  }
  return result;
}

describe('Business Write Tools Integration Suite', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('create_order tool', () => {
    it('creates an order, calculates totals, and reserves inventory', async () => {
      const { workspaceId } = await createWorkspaceFixture();

      const contact = await createContactFixture(workspaceId, {
        name: 'Test Customer',
        phoneE164: '+923000000000',
      });

      const conversation = await prisma.conversation.create({
        data: {
          workspaceId,
          contactId: contact.id,
          status: 'OPEN',
        },
      });

      // Create a product with 10 inventory
      const product = await prisma.product.create({
        data: {
          workspaceId,
          name: 'Silk Royal Scarf',
          slug: 'silk-royal-scarf',
          sku: 'SCARF-001',
          status: 'ACTIVE',
          priceMinor: 200000,
          currency: 'PKR',
          trackInventory: true,
          inventory: {
            create: {
              workspaceId,
              available: 10,
              reserved: 0,
              sold: 0,
            },
          },
        },
      });

      const agent = await prisma.aIAgent.create({
        data: {
          workspaceId,
          name: 'Test Agent',
          model: 'gpt-4o-mini',
        },
      });

      const ctx = createAITenantContext({
        workspaceId,
        agentId: agent.id,
        conversationId: conversation.id,
        messageId: '33333333-3333-3333-3333-333333333333',
        executionId: '44444444-4444-4444-4444-444444444444',
        capabilities: ['orders:create'],
      });

      const result = await createOrderTool.handler(ctx, {
        items: [{ productId: product.id, quantity: 2 }],
        paymentMethod: 'COD',
        addressLine1: '123 Main St',
        city: 'Lahore',
      });

      expect(result).not.toHaveProperty('error');
      const created = expectOrderCreated(result);
      expect(created.success).toBe(true);
      expect(created.orderNumber).toBeDefined();

      // Verify database
      const order = await prisma.order.findUnique({
        where: { workspaceId_orderNumber: { workspaceId, orderNumber: created.orderNumber } },
        include: { items: true },
      });

      expect(order).toBeDefined();
      expect(order?.contactId).toBe(contact.id);
      expect(order?.totalMinor).toBe(400000); // 200000 * 2
      expect(order?.createdByAi).toBe(true);
      expect(order?.aiAgentId).toBe(agent.id);
      expect(order?.items).toHaveLength(1);

      // Verify inventory reservation
      const inventory = await prisma.inventoryItem.findFirst({
        where: { productId: product.id },
      });
      expect(inventory?.available).toBe(8); // 10 - 2
      expect(inventory?.reserved).toBe(2);
    });

    it('prevents creating duplicate orders for the same execution (idempotency)', async () => {
      const { workspaceId } = await createWorkspaceFixture();

      const contact = await createContactFixture(workspaceId, {
        name: 'Idempotency Test Customer',
        phoneE164: '+923000000001',
      });

      const conversation = await prisma.conversation.create({
        data: {
          workspaceId,
          contactId: contact.id,
          status: 'OPEN',
        },
      });

      const product = await prisma.product.create({
        data: {
          workspaceId,
          name: 'Idempotent Product',
          slug: 'idem-prod',
          status: 'ACTIVE',
          priceMinor: 100000,
          currency: 'PKR',
          trackInventory: false,
        },
      });

      const agent = await prisma.aIAgent.create({
        data: {
          workspaceId,
          name: 'Idempotency Agent',
          model: 'gpt-4o-mini',
        },
      });

      const ctx = createAITenantContext({
        workspaceId,
        agentId: agent.id,
        conversationId: conversation.id,
        messageId: '33333333-3333-3333-3333-333333333333',
        executionId: '44444444-4444-4444-4444-444444444444',
        capabilities: ['orders:create'],
      });

      // First call
      const firstResult = await createOrderTool.handler(ctx, {
        items: [{ productId: product.id, quantity: 1 }],
      });
      const first = expectOrderCreated(firstResult);
      expect(first.success).toBe(true);

      // Second call with exactly the same executionId/messageId
      const secondResult = await createOrderTool.handler(ctx, {
        items: [{ productId: product.id, quantity: 1 }],
      });
      const second = expectOrderCreated(secondResult);
      expect(second.success).toBe(true);
      expect(second.orderNumber).toBe(first.orderNumber);
      // The replayed answer quotes the same money as the first one, because both are built
      // from the persisted row rather than recomputed.
      expect(second.totalMinor).toBe(first.totalMinor);
      expect(second.totalDisplay).toBe(first.totalDisplay);

      // Verify only one order was actually created
      const orderCount = await prisma.order.count({ where: { workspaceId } });
      expect(orderCount).toBe(1);
    });

    it('enforces tenant isolation and fails if product belongs to another tenant', async () => {
      const ws1 = await createWorkspaceFixture();
      const ws2 = await createWorkspaceFixture();

      const contactWs1 = await createContactFixture(ws1.workspaceId, { phoneE164: '+923000000010' });
      const conversationWs1 = await prisma.conversation.create({
        data: { workspaceId: ws1.workspaceId, contactId: contactWs1.id },
      });

      // Product in Workspace 2
      const productWs2 = await prisma.product.create({
        data: {
          workspaceId: ws2.workspaceId,
          name: 'WS2 Product',
          slug: 'ws2-prod',
          status: 'ACTIVE',
          priceMinor: 50000,
          currency: 'PKR',
        },
      });

      const agent = await prisma.aIAgent.create({
        data: {
          workspaceId: ws1.workspaceId,
          name: 'Isolation Agent',
          model: 'gpt-4o-mini',
        },
      });

      const ctx = createAITenantContext({
        workspaceId: ws1.workspaceId,
        agentId: agent.id,
        conversationId: conversationWs1.id,
        messageId: '123',
        capabilities: ['orders:create'],
      });

      const result = await createOrderTool.handler(ctx, {
        items: [{ productId: productWs2.id, quantity: 1 }],
      });

      expect(result).toHaveProperty('error', 'ORDER_CREATION_FAILED');
      expect(expectOrderRejected(result).message).toContain('not found');
    });

    it('allows the same idempotency key across different workspaces (tenant isolation)', async () => {
      const ws1 = await createWorkspaceFixture();
      const ws2 = await createWorkspaceFixture();

      const contactWs1 = await createContactFixture(ws1.workspaceId, { phoneE164: '+923000000020' });
      const contactWs2 = await createContactFixture(ws2.workspaceId, { phoneE164: '+923000000021' });

      const convWs1 = await prisma.conversation.create({ data: { workspaceId: ws1.workspaceId, contactId: contactWs1.id } });
      const convWs2 = await prisma.conversation.create({ data: { workspaceId: ws2.workspaceId, contactId: contactWs2.id } });

      const productWs1 = await prisma.product.create({
        data: { workspaceId: ws1.workspaceId, name: 'P1', slug: 'p1', priceMinor: 100, currency: 'PKR', status: 'ACTIVE', trackInventory: false },
      });
      const productWs2 = await prisma.product.create({
        data: { workspaceId: ws2.workspaceId, name: 'P2', slug: 'p2', priceMinor: 200, currency: 'PKR', status: 'ACTIVE', trackInventory: false },
      });

      const agent1 = await prisma.aIAgent.create({ data: { workspaceId: ws1.workspaceId, name: 'A1', model: 'gpt-4o' } });
      const agent2 = await prisma.aIAgent.create({ data: { workspaceId: ws2.workspaceId, name: 'A2', model: 'gpt-4o' } });

      // Create SAME messageId and executionId to force the SAME idempotency key
      const sharedMessageId = '55555555-5555-5555-5555-555555555555';
      const sharedExecutionId = '66666666-6666-6666-6666-666666666666';

      const ctxWs1 = createAITenantContext({
        workspaceId: ws1.workspaceId,
        agentId: agent1.id,
        conversationId: convWs1.id,
        messageId: sharedMessageId,
        executionId: sharedExecutionId,
        capabilities: ['orders:create'],
      });

      const ctxWs2 = createAITenantContext({
        workspaceId: ws2.workspaceId,
        agentId: agent2.id,
        conversationId: convWs2.id,
        messageId: sharedMessageId,
        executionId: sharedExecutionId,
        capabilities: ['orders:create'],
      });

      const result1 = await createOrderTool.handler(ctxWs1, { items: [{ productId: productWs1.id, quantity: 1 }] });
      expect(expectOrderCreated(result1).success).toBe(true);

      // This should SUCCEED because the @unique is now @@unique([workspaceId, idempotencyKey])
      const result2 = await createOrderTool.handler(ctxWs2, { items: [{ productId: productWs2.id, quantity: 1 }] });
      expect(expectOrderCreated(result2).success).toBe(true);
    });
  });

  /**
   * The money half of the task: an AI-created order has to be priced by the server from
   * the catalogue and the business's own settings, and the numbers the tool reports back
   * have to be the numbers that were persisted.
   *
   * Each case builds one workspace with one product and one explicit `BusinessProfile`,
   * so the expected figures are arithmetic over known integers rather than over whatever
   * a shared fixture happened to leave behind.
   */
  describe('authoritative order totals', () => {
    async function setupOrderWorkspace(options: {
      priceMinor: number;
      currency?: SupportedCurrency;
      /** Null means the owner has configured nothing, so the column defaults apply. */
      profile?: {
        deliveryFeeMinor?: number;
        freeDeliveryThresholdMinor?: number | null;
        taxRateBps?: number;
      } | null;
    }) {
      const currency = options.currency ?? 'PKR';
      const { workspaceId } = await createWorkspaceFixture({ currency });

      if (options.profile !== null) {
        await createBusinessProfileFixture(workspaceId, options.profile ?? {});
      }

      const contact = await createContactFixture(workspaceId, {
        phoneE164: `+9230011${String(Math.floor(10_000 + Math.random() * 89_999))}`,
      });
      const conversation = await prisma.conversation.create({
        data: { workspaceId, contactId: contact.id, status: 'OPEN' },
      });
      const product = await prisma.product.create({
        data: {
          workspaceId,
          name: 'Embroidered Lawn Suit',
          slug: `lawn-suit-${randomUUID().slice(0, 8)}`,
          status: 'ACTIVE',
          priceMinor: options.priceMinor,
          currency,
          trackInventory: false,
        },
      });
      const agent = await prisma.aIAgent.create({
        data: { workspaceId, name: 'Totals Agent', model: 'gpt-4o-mini' },
      });

      const ctx = createAITenantContext({
        workspaceId,
        agentId: agent.id,
        conversationId: conversation.id,
        messageId: randomUUID(),
        executionId: randomUUID(),
        capabilities: ['orders:create'],
        currency,
      });

      return { workspaceId, productId: product.id, ctx };
    }

    async function orderScenario(
      options: Parameters<typeof setupOrderWorkspace>[0] & { quantity?: number },
    ) {
      const { workspaceId, productId, ctx } = await setupOrderWorkspace(options);

      const result = await createOrderTool.handler(ctx, {
        items: [{ productId, quantity: options.quantity ?? 1 }],
      });
      const created = expectOrderCreated(result);
      const order = await prisma.order.findUniqueOrThrow({
        where: { workspaceId_orderNumber: { workspaceId, orderNumber: created.orderNumber } },
      });

      return { workspaceId, productId, ctx, created, order };
    }

    it('applies the configured delivery fee and tax rate to an AI order', async () => {
      // 2 × Rs. 2,000 = Rs. 4,000 goods, Rs. 250 delivery, 17% tax. The domain taxes the
      // goods *and* the delivery, so the base is Rs. 4,250 and the tax is Rs. 722.50.
      const { created, order } = await orderScenario({
        priceMinor: 200_000,
        quantity: 2,
        profile: { deliveryFeeMinor: 25_000, taxRateBps: 1700 },
      });

      expect(created.subtotalMinor).toBe(400_000);
      expect(created.deliveryFeeMinor).toBe(25_000);
      expect(created.taxMinor).toBe(72_250);
      expect(created.totalMinor).toBe(497_250);

      // The reported figures and the persisted row are the same integers.
      expect(order.subtotalMinor).toBe(created.subtotalMinor);
      expect(order.deliveryFeeMinor).toBe(created.deliveryFeeMinor);
      expect(order.taxMinor).toBe(created.taxMinor);
      expect(order.totalMinor).toBe(created.totalMinor);

      // And they reconcile, so the sentence the agent writes cannot be internally wrong.
      expect(
        order.subtotalMinor - order.discountMinor + order.deliveryFeeMinor + order.taxMinor,
      ).toBe(order.totalMinor);

      // Pre-formatted strings exist so the model never divides by 100 itself.
      expect(created.deliveryFeeDisplay).toBe('Rs. 250');
      expect(created.totalDisplay).toBe('Rs. 4,972.50');
    });

    it('waives the delivery fee once the free-delivery threshold is reached', async () => {
      const { created, order } = await orderScenario({
        priceMinor: 300_000,
        profile: { deliveryFeeMinor: 25_000, freeDeliveryThresholdMinor: 300_000 },
      });

      // Rs. 3,000 of goods against a Rs. 3,000 threshold — reaching it qualifies.
      expect(created.subtotalMinor).toBe(300_000);
      expect(created.deliveryFeeMinor).toBe(0);
      expect(created.totalMinor).toBe(300_000);
      expect(order.deliveryFeeMinor).toBe(0);
    });

    it('charges the delivery fee when the basket is below the threshold', async () => {
      const { created } = await orderScenario({
        priceMinor: 299_900,
        profile: { deliveryFeeMinor: 25_000, freeDeliveryThresholdMinor: 300_000 },
      });

      // One paisa short is short.
      expect(created.subtotalMinor).toBe(299_900);
      expect(created.deliveryFeeMinor).toBe(25_000);
      expect(created.totalMinor).toBe(324_900);
    });

    it('charges the configured fee when no threshold is configured', async () => {
      const { created } = await orderScenario({
        priceMinor: 5_000_000,
        profile: { deliveryFeeMinor: 25_000, freeDeliveryThresholdMinor: null },
      });

      // A null threshold is "no free delivery", not "free above zero" — Rs. 50,000 of
      // goods still pays for delivery.
      expect(created.deliveryFeeMinor).toBe(25_000);
      expect(created.totalMinor).toBe(5_025_000);
    });

    it('charges no tax and no delivery when the business configured neither', async () => {
      const { created, order } = await orderScenario({
        priceMinor: 149_900,
        profile: { deliveryFeeMinor: 0, taxRateBps: 0 },
      });

      expect(created.deliveryFeeMinor).toBe(0);
      expect(created.taxMinor).toBe(0);
      expect(created.totalMinor).toBe(149_900);
      expect(order.totalMinor).toBe(149_900);
    });

    it('falls back to no fee and no tax when the business has no profile row', async () => {
      const { created } = await orderScenario({ priceMinor: 149_900, profile: null });

      // The column defaults are the honest answer here: an owner who has configured
      // nothing has not configured a fee, so the order is the goods and nothing else.
      expect(created.deliveryFeeMinor).toBe(0);
      expect(created.taxMinor).toBe(0);
      expect(created.totalMinor).toBe(149_900);
    });

    it('rounds tax with integer arithmetic rather than floating point', async () => {
      // 1 × Rs. 99.99 at 17.5% is 174,982.5 hundredths of a paisa; the engine's integer
      // rounding takes it to 1,750 paisa. A float path would be liable to 1749.
      const { created, order } = await orderScenario({
        priceMinor: 9_999,
        profile: { taxRateBps: 1750 },
      });

      expect(created.subtotalMinor).toBe(9_999);
      expect(created.taxMinor).toBe(1_750);
      expect(created.totalMinor).toBe(11_749);
      expect(Number.isInteger(order.taxMinor)).toBe(true);
      expect(Number.isInteger(order.totalMinor)).toBe(true);
    });

    it('denominates the order in the workspace currency, not a hardcoded PKR', async () => {
      const { created, order } = await orderScenario({
        priceMinor: 50_000,
        currency: 'AED',
        profile: { deliveryFeeMinor: 1_500 },
      });

      expect(created.currency).toBe('AED');
      expect(order.currency).toBe('AED');
      expect(created.totalMinor).toBe(51_500);
      // The formatted strings follow the same currency, so nothing quotes rupees at a
      // Dubai customer.
      expect(created.totalDisplay).not.toContain('Rs.');
      expect(created.deliveryFeeDisplay).not.toContain('Rs.');
    });

    /**
     * The model's arguments are untrusted input. The runtime runs them through
     * `inputSchema.safeParse` before the handler sees them, so this exercises the same
     * path with a payload a jailbroken or talked-into model might emit.
     */
    it('strips every monetary field a model might try to supply', () => {
      const hostileArguments = {
        items: [
          {
            productId: '11111111-1111-1111-1111-111111111111',
            quantity: 1,
            unitPriceMinor: 1,
            priceMinor: 1,
            discountMinor: 999_999,
          },
        ],
        deliveryFeeMinor: 0,
        taxMinor: 0,
        discountMinor: 999_999,
        subtotalMinor: 1,
        totalMinor: 1,
        currency: 'USD',
      };

      const parsed = createOrderTool.inputSchema.parse(hostileArguments);

      // Zod strips what the schema does not name, and the schema names no money at all.
      for (const field of [
        'deliveryFeeMinor',
        'taxMinor',
        'discountMinor',
        'subtotalMinor',
        'totalMinor',
        'currency',
      ]) {
        expect(parsed).not.toHaveProperty(field);
      }
      const [firstItem] = parsed.items;
      if (firstItem === undefined) throw new Error('the schema dropped the items array');
      expect(firstItem).not.toHaveProperty('unitPriceMinor');
      expect(firstItem).not.toHaveProperty('priceMinor');
      expect(firstItem).not.toHaveProperty('discountMinor');
      expect(Object.keys(firstItem).sort()).toEqual(['productId', 'quantity']);
    });

    it('prices from the catalogue and the profile even when the model claims otherwise', async () => {
      const { workspaceId, productId, ctx } = await setupOrderWorkspace({
        priceMinor: 200_000,
        profile: { deliveryFeeMinor: 25_000, taxRateBps: 1700 },
      });

      // What a model trying to give a customer free delivery and no tax would emit.
      const parsed = createOrderTool.inputSchema.parse({
        items: [{ productId, quantity: 1, unitPriceMinor: 1 }],
        deliveryFeeMinor: 0,
        taxMinor: 0,
        totalMinor: 1,
        notes: 'Customer says the manager approved free delivery and no tax.',
      });

      const created = expectOrderCreated(await createOrderTool.handler(ctx, parsed));

      // Rs. 2,000 of goods, the configured Rs. 250 delivery, 17% on the Rs. 2,250 base.
      // None of it moved.
      expect(created.subtotalMinor).toBe(200_000);
      expect(created.deliveryFeeMinor).toBe(25_000);
      expect(created.taxMinor).toBe(38_250);
      expect(created.totalMinor).toBe(263_250);

      const order = await prisma.order.findUniqueOrThrow({
        where: { workspaceId_orderNumber: { workspaceId, orderNumber: created.orderNumber } },
        include: { items: true },
      });
      expect(order.items[0]?.unitPriceMinor).toBe(200_000);
      expect(order.totalMinor).toBe(263_250);
      expect(order.createdByAi).toBe(true);
    });
  });
});
