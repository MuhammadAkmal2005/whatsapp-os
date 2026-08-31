/**
 * Phase 9 Unit 2: Database Performance, Index Optimization & Constraint Integrity Tests.
 *
 * Validates:
 * 1. Partial unique index for InventoryItem (product-level stock).
 * 2. Partial unique index for AIAgent (one default agent per workspace).
 * 3. Background Job Queue claim prioritization (priority DESC, runAfter ASC).
 * 4. Composite index query correctness for Conversations, Contacts, Products, and Orders.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/db/prisma';
import { claimJobs } from '@/server/repositories/job.repository';
import { ensureStockRow } from '@/server/repositories/inventory.repository';
import { createWorkspaceFixture, resetDatabase } from '../fixtures';
import { listConversations } from '@/server/repositories/conversation.repository';
import { listContacts } from '@/server/repositories/contact.repository';
import { listProducts } from '@/server/repositories/product.repository';
import { listOrders } from '@/server/repositories/order.repository';

describe('Phase 9 Unit 2: Performance Indexes & Schema Integrity', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('1. InventoryItem Product-Level Stock Unique Constraint', () => {
    it('enforces single product-level stock row via partial unique index and handles concurrency in ensureStockRow', async () => {
      const fixture = await createWorkspaceFixture();

      const product = await prisma.product.create({
        data: {
          workspaceId: fixture.workspaceId,
          name: 'Silk Dupatta',
          slug: 'silk-dupatta',
          priceMinor: 150000,
          currency: 'PKR',
        },
      });

      // 1. Initial stock creation
      const stock1 = await ensureStockRow(prisma, fixture.workspaceId, product.id, null, {
        available: 10,
        lowStockThreshold: 2,
      });
      expect(stock1.available).toBe(10);

      // 2. Calling ensureStockRow again returns the existing row without duplicate creation
      const stock2 = await ensureStockRow(prisma, fixture.workspaceId, product.id, null, {
        available: 50,
      });
      expect(stock2.id).toBe(stock1.id);
      expect(stock2.available).toBe(10);

      // 3. Directly attempting raw duplicate insert on (productId, variantId=null) is rejected by PostgreSQL partial unique index
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO inventory_items (id, "workspaceId", "productId", "variantId", available, reserved, sold, "lowStockThreshold", "updatedAt")
          VALUES (gen_random_uuid(), '${fixture.workspaceId}', '${product.id}', NULL, 20, 0, 0, 3, now());
        `),
      ).rejects.toThrow();

      // Confirm only 1 inventoryItem row exists
      const count = await prisma.inventoryItem.count({
        where: { productId: product.id, variantId: null },
      });
      expect(count).toBe(1);
    });
  });

  describe('2. AIAgent isDefault Constraint & Indexing', () => {
    it('enforces at most one default agent per workspace via partial unique index', async () => {
      const fixture = await createWorkspaceFixture();

      // 1. First default agent in workspace
      const agent1 = await prisma.aIAgent.create({
        data: {
          workspaceId: fixture.workspaceId,
          name: 'Primary Support Agent',
          isDefault: true,
          isActive: true,
        },
      });
      expect(agent1.isDefault).toBe(true);

      // 2. Creating a second default agent in the same workspace is rejected by the partial unique index
      await expect(
        prisma.aIAgent.create({
          data: {
            workspaceId: fixture.workspaceId,
            name: 'Secondary Default Agent (Illegal)',
            isDefault: true,
            isActive: true,
          },
        }),
      ).rejects.toThrow();

      // 3. Creating a non-default agent in the same workspace succeeds
      const agent2 = await prisma.aIAgent.create({
        data: {
          workspaceId: fixture.workspaceId,
          name: 'Specialist Agent',
          isDefault: false,
          isActive: true,
        },
      });
      expect(agent2.isDefault).toBe(false);

      // 4. A second workspace can also have its own isDefault: true agent
      const fixture2 = await createWorkspaceFixture({ name: 'Second Business' });
      const agentWorkspace2 = await prisma.aIAgent.create({
        data: {
          workspaceId: fixture2.workspaceId,
          name: 'Workspace 2 Default Agent',
          isDefault: true,
          isActive: true,
        },
      });
      expect(agentWorkspace2.isDefault).toBe(true);
    });
  });

  describe('3. Job Queue Index & Prioritization', () => {
    it('claims pending jobs ordered by priority DESC then runAfter ASC using the new composite index', async () => {
      const fixture = await createWorkspaceFixture();
      const now = new Date();
      const past1 = new Date(now.getTime() - 5000);
      const past2 = new Date(now.getTime() - 10000);

      // Insert jobs with different priorities and times
      await prisma.job.createMany({
        data: [
          { type: 'analytics.rollup', payload: {}, priority: 0, runAfter: past2, workspaceId: fixture.workspaceId },
          { type: 'whatsapp.send', payload: {}, priority: 10, runAfter: past1, workspaceId: fixture.workspaceId },
          { type: 'ai.turn', payload: {}, priority: 5, runAfter: past2, workspaceId: fixture.workspaceId },
        ],
      });

      // Claim jobs
      const claimed = await claimJobs(prisma, 'worker-bench', 3);

      expect(claimed).toHaveLength(3);
      // Priority 10 first, then 5, then 0
      expect(claimed[0]?.type).toBe('whatsapp.send');
      expect(claimed[1]?.type).toBe('ai.turn');
      expect(claimed[2]?.type).toBe('analytics.rollup');
    });
  });

  describe('4. Composite Index Query Correctness & Soft-Delete Filtering', () => {
    it('executes listConversations, listContacts, listProducts, listOrders correctly with tenant and soft-delete scoping', async () => {
      const fixture = await createWorkspaceFixture();

      // Create contact
      const contact = await prisma.contact.create({
        data: {
          workspaceId: fixture.workspaceId,
          name: 'Active Contact',
          phoneE164: '+923001234567',
        },
      });

      // Create soft-deleted contact
      await prisma.contact.create({
        data: {
          workspaceId: fixture.workspaceId,
          name: 'Deleted Contact',
          phoneE164: '+923007654321',
          deletedAt: new Date(),
        },
      });

      // Create product
      const product = await prisma.product.create({
        data: {
          workspaceId: fixture.workspaceId,
          name: 'Active Kurti',
          slug: 'active-kurti',
          priceMinor: 200000,
          currency: 'PKR',
        },
      });

      // Create soft-deleted product
      await prisma.product.create({
        data: {
          workspaceId: fixture.workspaceId,
          name: 'Archived Kurti',
          slug: 'archived-kurti',
          priceMinor: 200000,
          currency: 'PKR',
          deletedAt: new Date(),
        },
      });

      // Create order
      await prisma.order.create({
        data: {
          workspaceId: fixture.workspaceId,
          orderNumber: 'ORD-2608-0001',
          contactId: contact.id,
          subtotalMinor: 200000,
          totalMinor: 200000,
          customerName: 'Active Contact',
          phoneE164: '+923001234567',
        },
      });

      // Create conversation
      await prisma.conversation.create({
        data: {
          workspaceId: fixture.workspaceId,
          contactId: contact.id,
          status: 'OPEN',
          lastMessageAt: new Date(),
        },
      });

      // Verify listContacts excludes soft-deleted
      const contactsPage = await listContacts(prisma, fixture.workspaceId, { limit: 10, search: null });
      expect(contactsPage.rows).toHaveLength(1);
      expect(contactsPage.rows[0]?.name).toBe('Active Contact');

      // Verify listProducts excludes soft-deleted
      const productsPage = await listProducts(prisma, fixture.workspaceId, { limit: 10, search: null });
      expect(productsPage.rows).toHaveLength(1);
      expect(productsPage.rows[0]?.name).toBe('Active Kurti');

      // Verify listOrders
      const ordersPage = await listOrders(prisma, fixture.workspaceId, { limit: 10, search: null });
      expect(ordersPage.rows).toHaveLength(1);
      expect(ordersPage.rows[0]?.orderNumber).toBe('ORD-2608-0001');

      // Verify listConversations
      const convPage = await listConversations(prisma, fixture.workspaceId, { limit: 10 });
      expect(convPage.rows).toHaveLength(1);
    });
  });
});
