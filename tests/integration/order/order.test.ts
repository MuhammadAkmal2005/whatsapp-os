/**
 * Order service integration tests.
 *
 * These tests verify the critical order behaviors that MUST work:
 * - Cross-tenant isolation: orders never leak between workspaces
 * - Permissions: order:create/update/cancel are enforced server-side
 * - Inventory correctness: stock is reserved on create, released on cancel, marked sold on delivery
 * - Server-side totals: the service recomputes totals from database prices, never trusts client input
 * - Status transitions: only legal moves are allowed, terminal statuses stay terminal
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { prisma } from '@/db/prisma';
import {
  createOrder,
  cancelOrder,
  updateOrderStatus,
  listOrders,
  getOrderDetail,
} from '@/server/services/order/order.service';
import { ForbiddenError, NotFoundError } from '@/server/errors';
import type { CreateOrderInput } from '@/server/validation/order';
import {
  createBusinessProfileFixture,
  createContactFixture,
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
  type WorkspaceFixture,
} from '../fixtures';

describe('Order service — cross-tenant isolation', () => {
  let workspaceA: WorkspaceFixture;
  let workspaceB: WorkspaceFixture;
  let contactA: { id: string; phoneE164: string; name: string };
  let contactB: { id: string; phoneE164: string; name: string };
  let productA: { id: string };
  let productB: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    workspaceA = await createWorkspaceFixture({ name: 'Workspace A' });
    workspaceB = await createWorkspaceFixture({ name: 'Workspace B' });

    // Workspace A: one contact, one product with 100 stock
    contactA = await createContactFixture(workspaceA.workspaceId, {
      name: 'Customer A',
      phoneE164: '+923001111111',
    });

    const pA = await prisma.product.create({
      data: {
        workspaceId: workspaceA.workspaceId,
        name: 'Product A',
        slug: 'product-a',
        status: 'ACTIVE',
        trackInventory: true,
        priceMinor: 1000,
        currency: 'PKR',
      },
    });
    productA = pA;

    await prisma.inventoryItem.create({
      data: {
        workspaceId: workspaceA.workspaceId,
        productId: productA.id,
        variantId: null,
        available: 100,
        reserved: 0,
        sold: 0,
      },
    });

    // Workspace B: one contact, one product with 100 stock
    contactB = await createContactFixture(workspaceB.workspaceId, {
      name: 'Customer B',
      phoneE164: '+923002222222',
    });

    const pB = await prisma.product.create({
      data: {
        workspaceId: workspaceB.workspaceId,
        name: 'Product B',
        slug: 'product-b',
        status: 'ACTIVE',
        trackInventory: true,
        priceMinor: 2000,
        currency: 'PKR',
      },
    });
    productB = pB;

    await prisma.inventoryItem.create({
      data: {
        workspaceId: workspaceB.workspaceId,
        productId: productB.id,
        variantId: null,
        available: 100,
        reserved: 0,
        sold: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('does not allow workspace A to create an order for workspace B contact', async () => {
    const input: CreateOrderInput = {
      contactId: contactB.id, // belongs to workspace B
      items: [{ productId: productA.id, variantId: null, quantity: 1 }],
      customerName: 'Customer B',
      phoneE164: '+923002222222',
      country: 'PK',
      paymentMethod: 'COD',
    };

    await expect(createOrder(workspaceA.context, input)).rejects.toThrow(NotFoundError);
  });

  it('does not allow workspace A to create an order for workspace B product', async () => {
    const input: CreateOrderInput = {
      contactId: contactA.id,
      items: [{ productId: productB.id, variantId: null, quantity: 1 }], // belongs to workspace B
      customerName: 'Customer A',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
    };

    await expect(createOrder(workspaceA.context, input)).rejects.toThrow(NotFoundError);
  });

  it('does not return workspace B orders when workspace A lists orders', async () => {
    const inputA: CreateOrderInput = {
      contactId: contactA.id,
      items: [{ productId: productA.id, variantId: null, quantity: 1 }],
      customerName: 'Customer A',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
    };

    const inputB: CreateOrderInput = {
      contactId: contactB.id,
      items: [{ productId: productB.id, variantId: null, quantity: 1 }],
      customerName: 'Customer B',
      phoneE164: '+923002222222',
      country: 'PK',
      paymentMethod: 'COD',
    };

    const orderA = await createOrder(workspaceA.context, inputA);
    const orderB = await createOrder(workspaceB.context, inputB);

    const pageA = await listOrders(workspaceA.context, { limit: 20 });
    const pageB = await listOrders(workspaceB.context, { limit: 20 });

    expect(pageA.orders).toHaveLength(1);
    expect(pageA.orders[0]?.id).toBe(orderA.id);

    expect(pageB.orders).toHaveLength(1);
    expect(pageB.orders[0]?.id).toBe(orderB.id);
  });

  it('returns null when workspace A tries to read workspace B order by id', async () => {
    const inputB: CreateOrderInput = {
      contactId: contactB.id,
      items: [{ productId: productB.id, variantId: null, quantity: 1 }],
      customerName: 'Customer B',
      phoneE164: '+923002222222',
      country: 'PK',
      paymentMethod: 'COD',
    };

    const orderB = await createOrder(workspaceB.context, inputB);

    const result = await getOrderDetail(workspaceA.context, orderB.id);
    expect(result).toBeNull();
  });
});

describe('Order service — permissions', () => {
  let workspace: WorkspaceFixture;
  let contact: { id: string; phoneE164: string; name: string };
  let product: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    workspace = await createWorkspaceFixture({ name: 'Permissions Test WS' });

    contact = await createContactFixture(workspace.workspaceId, {
      name: 'Customer',
      phoneE164: '+923001111111',
    });

    product = await prisma.product.create({
      data: {
        workspaceId: workspace.workspaceId,
        name: 'Product',
        slug: 'product',
        status: 'ACTIVE',
        trackInventory: true,
        priceMinor: 1000,
        currency: 'PKR',
      },
    });

    await prisma.inventoryItem.create({
      data: {
        workspaceId: workspace.workspaceId,
        productId: product.id,
        variantId: null,
        available: 100,
        reserved: 0,
        sold: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('throws when creating an order without order:create permission (VIEWER)', async () => {
    const viewer = await createMemberFixture(workspace.workspaceId, 'VIEWER', {
      name: 'Viewer User',
    });
    const viewerCtx = tenantContextFor({
      workspaceId: workspace.workspaceId,
      workspaceSlug: workspace.workspaceSlug,
      workspaceName: 'Permissions Test WS',
      currency: 'PKR',
      userId: viewer.userId,
      userName: viewer.name,
      userEmail: viewer.email,
      membershipId: viewer.membershipId,
      role: 'VIEWER',
    });

    const input: CreateOrderInput = {
      contactId: contact.id,
      items: [{ productId: product.id, variantId: null, quantity: 1 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
    };

    await expect(createOrder(viewerCtx, input)).rejects.toThrow(ForbiddenError);
  });

  it('throws when cancelling an order without order:cancel permission (AGENT)', async () => {
    const agent = await createMemberFixture(workspace.workspaceId, 'AGENT', {
      name: 'Agent User',
    });
    const agentCtx = tenantContextFor({
      workspaceId: workspace.workspaceId,
      workspaceSlug: workspace.workspaceSlug,
      workspaceName: 'Permissions Test WS',
      currency: 'PKR',
      userId: agent.userId,
      userName: agent.name,
      userEmail: agent.email,
      membershipId: agent.membershipId,
      role: 'AGENT',
    });

    const input: CreateOrderInput = {
      contactId: contact.id,
      items: [{ productId: product.id, variantId: null, quantity: 1 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
    };

    const order = await createOrder(workspace.context, input);

    await expect(cancelOrder(agentCtx, order.id, { reason: 'Test' })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe('Order service — inventory correctness', () => {
  let workspace: WorkspaceFixture;
  let contact: { id: string; phoneE164: string; name: string };
  let product: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    workspace = await createWorkspaceFixture({ name: 'Inventory Test WS' });

    contact = await createContactFixture(workspace.workspaceId, {
      name: 'Customer',
      phoneE164: '+923001111111',
    });

    product = await prisma.product.create({
      data: {
        workspaceId: workspace.workspaceId,
        name: 'Product',
        slug: 'product',
        status: 'ACTIVE',
        trackInventory: true,
        priceMinor: 1000,
        currency: 'PKR',
      },
    });

    await prisma.inventoryItem.create({
      data: {
        workspaceId: workspace.workspaceId,
        productId: product.id,
        variantId: null,
        available: 100,
        reserved: 0,
        sold: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reserves stock when an order is created', async () => {
    const input: CreateOrderInput = {
      contactId: contact.id,
      items: [{ productId: product.id, variantId: null, quantity: 5 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
    };

    await createOrder(workspace.context, input);

    const stock = await prisma.inventoryItem.findFirst({
      where: { workspaceId: workspace.workspaceId, productId: product.id, variantId: null },
    });

    expect(stock?.available).toBe(95);
    expect(stock?.reserved).toBe(5);
    expect(stock?.sold).toBe(0);
  });

  it('releases stock when an order is cancelled', async () => {
    const input: CreateOrderInput = {
      contactId: contact.id,
      items: [{ productId: product.id, variantId: null, quantity: 5 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
    };

    const order = await createOrder(workspace.context, input);

    await cancelOrder(workspace.context, order.id, { reason: 'Customer changed mind' });

    const stock = await prisma.inventoryItem.findFirst({
      where: { workspaceId: workspace.workspaceId, productId: product.id, variantId: null },
    });

    expect(stock?.available).toBe(100);
    expect(stock?.reserved).toBe(0);
    expect(stock?.sold).toBe(0);
  });

  it('marks stock as sold when an order is delivered', async () => {
    const input: CreateOrderInput = {
      contactId: contact.id,
      items: [{ productId: product.id, variantId: null, quantity: 5 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
    };

    const order = await createOrder(workspace.context, input);

    // PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
    await updateOrderStatus(workspace.context, order.id, { status: 'CONFIRMED' });
    await updateOrderStatus(workspace.context, order.id, { status: 'PROCESSING' });
    await updateOrderStatus(workspace.context, order.id, { status: 'SHIPPED' });
    await updateOrderStatus(workspace.context, order.id, { status: 'DELIVERED' });

    const stock = await prisma.inventoryItem.findFirst({
      where: { workspaceId: workspace.workspaceId, productId: product.id, variantId: null },
    });

    expect(stock?.available).toBe(95);
    expect(stock?.reserved).toBe(0);
    expect(stock?.sold).toBe(5);
  });
});

describe('Order service — server-side totals', () => {
  let workspace: WorkspaceFixture;
  let contact: { id: string; phoneE164: string; name: string };
  let product: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    workspace = await createWorkspaceFixture({ name: 'Totals Test WS' });

    contact = await createContactFixture(workspace.workspaceId, {
      name: 'Customer',
      phoneE164: '+923001111111',
    });

    product = await prisma.product.create({
      data: {
        workspaceId: workspace.workspaceId,
        name: 'Product',
        slug: 'product',
        status: 'ACTIVE',
        trackInventory: true,
        priceMinor: 1000,
        currency: 'PKR',
      },
    });

    await prisma.inventoryItem.create({
      data: {
        workspaceId: workspace.workspaceId,
        productId: product.id,
        variantId: null,
        available: 100,
        reserved: 0,
        sold: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('computes the order total from database prices, ignoring any client-provided total', async () => {
    // Client sends quantity 3 at price 1000 each = subtotal 3000
    const input: CreateOrderInput = {
      contactId: contact.id,
      items: [{ productId: product.id, variantId: null, quantity: 3 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
    };

    const order = await createOrder(workspace.context, input);

    // Server reads price from database (1000), multiplies by quantity (3) = 3000
    expect(order.subtotalMinor).toBe(3000);
    expect(order.totalMinor).toBe(3000);
  });

  it('applies optional discount/delivery/tax overrides when provided', async () => {
    const input: CreateOrderInput = {
      contactId: contact.id,
      items: [{ productId: product.id, variantId: null, quantity: 2 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
      discountMinor: 200,
      deliveryFeeMinor: 300,
      taxMinor: 100,
    };

    const order = await createOrder(workspace.context, input);

    // Subtotal: 2 × 1000 = 2000
    // Discount: -200
    // Delivery: +300
    // Tax: +100
    // Total: 2000 - 200 + 300 + 100 = 2200
    expect(order.subtotalMinor).toBe(2000);
    expect(order.discountMinor).toBe(200);
    expect(order.deliveryFeeMinor).toBe(300);
    expect(order.taxMinor).toBe(100);
    expect(order.totalMinor).toBe(2200);
  });
});

/**
 * The business's own settings are what price an order when the caller supplies no
 * explicit figures — which is every AI order and most dashboard orders.
 *
 * These go through `createOrder` rather than through the domain function directly, so
 * they cover the part that was actually broken: the service used to default the fee and
 * the tax to zero and never read `BusinessProfile` at all.
 */
describe('Order service — business settings drive the totals', () => {
  let workspace: WorkspaceFixture;
  let contact: { id: string; phoneE164: string; name: string };
  let product: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    workspace = await createWorkspaceFixture({ name: 'Business Settings WS' });

    contact = await createContactFixture(workspace.workspaceId, {
      name: 'Customer',
      phoneE164: '+923001111111',
    });

    product = await prisma.product.create({
      data: {
        workspaceId: workspace.workspaceId,
        name: 'Kameez',
        slug: 'kameez',
        status: 'ACTIVE',
        trackInventory: false,
        priceMinor: 100_000,
        currency: 'PKR',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function orderFor(quantity: number, overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
    return {
      contactId: contact.id,
      items: [{ productId: product.id, variantId: null, quantity }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      country: 'PK',
      paymentMethod: 'COD',
      ...overrides,
    };
  }

  it('charges the delivery fee configured on the business profile', async () => {
    await createBusinessProfileFixture(workspace.workspaceId, { deliveryFeeMinor: 25_000 });

    const order = await createOrder(workspace.context, orderFor(1));

    expect(order.subtotalMinor).toBe(100_000);
    expect(order.deliveryFeeMinor).toBe(25_000);
    expect(order.taxMinor).toBe(0);
    expect(order.totalMinor).toBe(125_000);
  });

  it('waives the configured fee once the basket reaches the configured threshold', async () => {
    await createBusinessProfileFixture(workspace.workspaceId, {
      deliveryFeeMinor: 25_000,
      freeDeliveryThresholdMinor: 200_000,
    });

    const qualifying = await createOrder(workspace.context, orderFor(2));
    expect(qualifying.subtotalMinor).toBe(200_000);
    expect(qualifying.deliveryFeeMinor).toBe(0);
    expect(qualifying.totalMinor).toBe(200_000);

    const notQualifying = await createOrder(workspace.context, orderFor(1));
    expect(notQualifying.deliveryFeeMinor).toBe(25_000);
    expect(notQualifying.totalMinor).toBe(125_000);
  });

  it('charges tax at the configured basis-point rate on goods and delivery', async () => {
    await createBusinessProfileFixture(workspace.workspaceId, {
      deliveryFeeMinor: 25_000,
      taxRateBps: 1700,
    });

    const order = await createOrder(workspace.context, orderFor(1));

    // 17% of Rs. 1,250 is Rs. 212.50.
    expect(order.taxMinor).toBe(21_250);
    expect(order.totalMinor).toBe(146_250);
    expect(
      order.subtotalMinor - order.discountMinor + order.deliveryFeeMinor + order.taxMinor,
    ).toBe(order.totalMinor);
  });

  it('takes an explicitly entered delivery fee literally, threshold and all', async () => {
    await createBusinessProfileFixture(workspace.workspaceId, {
      deliveryFeeMinor: 25_000,
      freeDeliveryThresholdMinor: 100_000,
    });

    // The basket reaches the threshold, but a human typed Rs. 50 into the dashboard.
    // Silently zeroing what someone just entered is worse than honouring it: they can
    // see the field and they meant it.
    const order = await createOrder(workspace.context, orderFor(1, { deliveryFeeMinor: 5_000 }));

    expect(order.deliveryFeeMinor).toBe(5_000);
    expect(order.totalMinor).toBe(105_000);
  });

  it('prices on the column defaults when the business has no profile row', async () => {
    const order = await createOrder(workspace.context, orderFor(1));

    expect(order.deliveryFeeMinor).toBe(0);
    expect(order.taxMinor).toBe(0);
    expect(order.totalMinor).toBe(100_000);
  });
});
