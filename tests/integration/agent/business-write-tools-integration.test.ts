import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/db/prisma';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { createAITenantContext } from '@/server/services/agent/context';
import { createOrderTool } from '@/server/services/agent/tools/impl/create-order.tool';
import { defaultToolRegistry, ToolRegistry } from '@/server/services/agent/tools/registry';
import { createContactFixture, createWorkspaceFixture, resetDatabase } from '../fixtures';

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
      expect(result.success).toBe(true);
      expect(result.orderNumber).toBeDefined();

      // Verify database
      const order = await prisma.order.findUnique({
        where: { workspaceId_orderNumber: { workspaceId, orderNumber: result.orderNumber } },
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
      expect(firstResult.success).toBe(true);

      // Second call with exactly the same executionId/messageId
      const secondResult = await createOrderTool.handler(ctx, {
        items: [{ productId: product.id, quantity: 1 }],
      });
      expect(secondResult.success).toBe(true);
      expect(secondResult.orderNumber).toBe(firstResult.orderNumber);

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
      expect((result as any).message).toContain('not found');
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
      if (!result1.success) throw new Error(JSON.stringify(result1));
      expect(result1.success).toBe(true);

      // This should SUCCEED because the @unique is now @@unique([workspaceId, idempotencyKey])
      const result2 = await createOrderTool.handler(ctxWs2, { items: [{ productId: productWs2.id, quantity: 1 }] });
      if (!result2.success) throw new Error(JSON.stringify(result2));
      expect(result2.success).toBe(true);
    });
  });
});
