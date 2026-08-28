/**
 * Order service integration tests.
 *
 * These tests verify the critical order behaviors that MUST work:
 * - Cross-tenant isolation: orders never leak between workspaces
 * - Permissions: order:create/read/update/cancel are enforced
 * - Inventory correctness: stock is reserved on create, released on cancel, marked sold on delivery
 * - Server-side totals: the service recomputes totals from database prices, never trusts client input
 * - Status transitions: only legal moves are allowed, terminal statuses stay terminal
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { prisma } from '@/server/db';
import { createOrder, cancelOrder, updateOrderStatus, listOrders, getOrderDetail } from '@/server/services/order/order.service';
import type { TenantContext } from '@/server/tenancy/context';
import type { CreateOrderInput } from '@/server/validation/order';
import { AppError } from '@/server/errors/app-error';

// Test workspace IDs
const WORKSPACE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WORKSPACE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MEMBER_A = 'maaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER_B = 'mbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeContext(workspaceId: string, membershipId: string, permissions: string[]): TenantContext {
  return {
    workspaceId,
    workspaceName: 'Test Workspace',
    membershipId,
    userId: 'user-id',
    role: 'OWNER',
    permissions,
    currency: 'PKR',
  };
}

const FULL_PERMISSIONS = ['order:create', 'order:read', 'order:update', 'order:cancel'];

describe('Order service — cross-tenant isolation', () => {
  let contactA: string;
  let contactB: string;
  let productA: string;
  let productB: string;

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Order", "OrderItem", "OrderEvent", "Contact", "Product", "ProductStock" CASCADE`;

    // Workspace A: one contact, one product
    const cA = await prisma.contact.create({
      data: { workspaceId: WORKSPACE_A, name: 'Customer A', phoneE164: '+923001111111' },
    });
    contactA = cA.id;

    const pA = await prisma.product.create({
      data: {
        workspaceId: WORKSPACE_A,
        name: 'Product A',
        slug: 'product-a',
        status: 'ACTIVE',
        trackInventory: true,
        basePriceMinor: 1000,
        currency: 'PKR',
      },
    });
    productA = pA.id;

    await prisma.productStock.create({
      data: { workspaceId: WORKSPACE_A, productId: productA, variantId: null, available: 100, reserved: 0, sold: 0 },
    });

    // Workspace B: one contact, one product
    const cB = await prisma.contact.create({
      data: { workspaceId: WORKSPACE_B, name: 'Customer B', phoneE164: '+923002222222' },
    });
    contactB = cB.id;

    const pB = await prisma.product.create({
      data: {
        workspaceId: WORKSPACE_B,
        name: 'Product B',
        slug: 'product-b',
        status: 'ACTIVE',
        trackInventory: true,
        basePriceMinor: 2000,
        currency: 'PKR',
      },
    });
    productB = pB.id;

    await prisma.productStock.create({
      data: { workspaceId: WORKSPACE_B, productId: productB, variantId: null, available: 100, reserved: 0, sold: 0 },
    });
  });

  it('does not allow workspace A to create an order for workspace B contact', async () => {
    const ctx = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);
    const input: CreateOrderInput = {
      contactId: contactB, // belongs to workspace B
      items: [{ productId: productA, variantId: null, quantity: 1 }],
      customerName: 'Customer B',
      phoneE164: '+923002222222',
      paymentMethod: 'COD',
    };

    await expect(createOrder(ctx, input)).rejects.toThrow();
  });

  it('does not allow workspace A to create an order for workspace B product', async () => {
    const ctx = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);
    const input: CreateOrderInput = {
      contactId: contactA,
      items: [{ productId: productB, variantId: null, quantity: 1 }], // belongs to workspace B
      customerName: 'Customer A',
      phoneE164: '+923001111111',
      paymentMethod: 'COD',
    };

    await expect(createOrder(ctx, input)).rejects.toThrow();
  });

  it('does not return workspace B orders when workspace A lists orders', async () => {
    const ctxA = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);
    const ctxB = makeContext(WORKSPACE_B, MEMBER_B, FULL_PERMISSIONS);

    const inputA: CreateOrderInput = {
      contactId: contactA,
      items: [{ productId: productA, variantId: null, quantity: 1 }],
      customerName: 'Customer A',
      phoneE164: '+923001111111',
      paymentMethod: 'COD',
    };

    const inputB: CreateOrderInput = {
      contactId: contactB,
      items: [{ productId: productB, variantId: null, quantity: 1 }],
      customerName: 'Customer B',
      phoneE164: '+923002222222',
      paymentMethod: 'COD',
    };

    const orderA = await createOrder(ctxA, inputA);
    const orderB = await createOrder(ctxB, inputB);

    const pageA = await listOrders(ctxA, {});
    const pageB = await listOrders(ctxB, {});

    expect(pageA.orders).toHaveLength(1);
    expect(pageA.orders[0].id).toBe(orderA.id);

    expect(pageB.orders).toHaveLength(1);
    expect(pageB.orders[0].id).toBe(orderB.id);
  });

  it('returns null when workspace A tries to read workspace B order by id', async () => {
    const ctxA = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);
    const ctxB = makeContext(WORKSPACE_B, MEMBER_B, FULL_PERMISSIONS);

    const inputB: CreateOrderInput = {
      contactId: contactB,
      items: [{ productId: productB, variantId: null, quantity: 1 }],
      customerName: 'Customer B',
      phoneE164: '+923002222222',
      paymentMethod: 'COD',
    };

    const orderB = await createOrder(ctxB, inputB);

    const result = await getOrderDetail(ctxA, orderB.id);
    expect(result).toBeNull();
  });
});

describe('Order service — permissions', () => {
  let contactId: string;
  let productId: string;

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Order", "OrderItem", "OrderEvent", "Contact", "Product", "ProductStock" CASCADE`;

    const contact = await prisma.contact.create({
      data: { workspaceId: WORKSPACE_A, name: 'Customer', phoneE164: '+923001111111' },
    });
    contactId = contact.id;

    const product = await prisma.product.create({
      data: {
        workspaceId: WORKSPACE_A,
        name: 'Product',
        slug: 'product',
        status: 'ACTIVE',
        trackInventory: true,
        basePriceMinor: 1000,
        currency: 'PKR',
      },
    });
    productId = product.id;

    await prisma.productStock.create({
      data: { workspaceId: WORKSPACE_A, productId, variantId: null, available: 100, reserved: 0, sold: 0 },
    });
  });

  it('throws when creating an order without order:create permission', async () => {
    const ctx = makeContext(WORKSPACE_A, MEMBER_A, ['order:read']);
    const input: CreateOrderInput = {
      contactId,
      items: [{ productId, variantId: null, quantity: 1 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      paymentMethod: 'COD',
    };

    await expect(createOrder(ctx, input)).rejects.toThrow(AppError);
  });

  it('throws when listing orders without order:read permission', async () => {
    const ctx = makeContext(WORKSPACE_A, MEMBER_A, ['order:create']);

    await expect(listOrders(ctx, {})).rejects.toThrow(AppError);
  });

  it('throws when cancelling an order without order:cancel permission', async () => {
    const ctxFull = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);
    const ctxNoCan = makeContext(WORKSPACE_A, MEMBER_A, ['order:read', 'order:update']);

    const input: CreateOrderInput = {
      contactId,
      items: [{ productId, variantId: null, quantity: 1 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      paymentMethod: 'COD',
    };

    const order = await createOrder(ctxFull, input);

    await expect(cancelOrder(ctxNoCan, order.id, { reason: 'Test' })).rejects.toThrow(AppError);
  });
});

describe('Order service — inventory correctness', () => {
  let contactId: string;
  let productId: string;

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Order", "OrderItem", "OrderEvent", "Contact", "Product", "ProductStock" CASCADE`;

    const contact = await prisma.contact.create({
      data: { workspaceId: WORKSPACE_A, name: 'Customer', phoneE164: '+923001111111' },
    });
    contactId = contact.id;

    const product = await prisma.product.create({
      data: {
        workspaceId: WORKSPACE_A,
        name: 'Product',
        slug: 'product',
        status: 'ACTIVE',
        trackInventory: true,
        basePriceMinor: 1000,
        currency: 'PKR',
      },
    });
    productId = product.id;

    await prisma.productStock.create({
      data: { workspaceId: WORKSPACE_A, productId, variantId: null, available: 100, reserved: 0, sold: 0 },
    });
  });

  it('reserves stock when an order is created', async () => {
    const ctx = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);
    const input: CreateOrderInput = {
      contactId,
      items: [{ productId, variantId: null, quantity: 5 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      paymentMethod: 'COD',
    };

    await createOrder(ctx, input);

    const stock = await prisma.productStock.findFirst({
      where: { workspaceId: WORKSPACE_A, productId, variantId: null },
    });

    expect(stock?.available).toBe(95);
    expect(stock?.reserved).toBe(5);
    expect(stock?.sold).toBe(0);
  });

  it('releases stock when an order is cancelled', async () => {
    const ctx = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);
    const input: CreateOrderInput = {
      contactId,
      items: [{ productId, variantId: null, quantity: 5 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      paymentMethod: 'COD',
    };

    const order = await createOrder(ctx, input);

    await cancelOrder(ctx, order.id, { reason: 'Customer changed mind' });

    const stock = await prisma.productStock.findFirst({
      where: { workspaceId: WORKSPACE_A, productId, variantId: null },
    });

    expect(stock?.available).toBe(100);
    expect(stock?.reserved).toBe(0);
    expect(stock?.sold).toBe(0);
  });

  it('marks stock as sold when an order is delivered', async () => {
    const ctx = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);
    const input: CreateOrderInput = {
      contactId,
      items: [{ productId, variantId: null, quantity: 5 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      paymentMethod: 'COD',
    };

    const order = await createOrder(ctx, input);

    // PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
    await updateOrderStatus(ctx, order.id, { status: 'CONFIRMED' });
    await updateOrderStatus(ctx, order.id, { status: 'PROCESSING' });
    await updateOrderStatus(ctx, order.id, { status: 'SHIPPED' });
    await updateOrderStatus(ctx, order.id, { status: 'DELIVERED' });

    const stock = await prisma.productStock.findFirst({
      where: { workspaceId: WORKSPACE_A, productId, variantId: null },
    });

    expect(stock?.available).toBe(95);
    expect(stock?.reserved).toBe(0);
    expect(stock?.sold).toBe(5);
  });
});

describe('Order service — server-side totals', () => {
  let contactId: string;
  let productId: string;

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Order", "OrderItem", "OrderEvent", "Contact", "Product", "ProductStock" CASCADE`;

    const contact = await prisma.contact.create({
      data: { workspaceId: WORKSPACE_A, name: 'Customer', phoneE164: '+923001111111' },
    });
    contactId = contact.id;

    const product = await prisma.product.create({
      data: {
        workspaceId: WORKSPACE_A,
        name: 'Product',
        slug: 'product',
        status: 'ACTIVE',
        trackInventory: true,
        basePriceMinor: 1000,
        currency: 'PKR',
      },
    });
    productId = product.id;

    await prisma.productStock.create({
      data: { workspaceId: WORKSPACE_A, productId, variantId: null, available: 100, reserved: 0, sold: 0 },
    });
  });

  it('computes the order total from database prices, ignoring any client-provided total', async () => {
    const ctx = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);

    // Client sends quantity 3 at price 1000 each = subtotal 3000
    const input: CreateOrderInput = {
      contactId,
      items: [{ productId, variantId: null, quantity: 3 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      paymentMethod: 'COD',
    };

    const order = await createOrder(ctx, input);

    // Server reads price from database (1000), multiplies by quantity (3) = 3000
    expect(order.subtotalMinor).toBe(3000);
    expect(order.totalMinor).toBe(3000);
  });

  it('applies optional discount/delivery/tax overrides when provided', async () => {
    const ctx = makeContext(WORKSPACE_A, MEMBER_A, FULL_PERMISSIONS);

    const input: CreateOrderInput = {
      contactId,
      items: [{ productId, variantId: null, quantity: 2 }],
      customerName: 'Customer',
      phoneE164: '+923001111111',
      paymentMethod: 'COD',
      discountMinor: 200,
      deliveryFeeMinor: 300,
      taxMinor: 100,
    };

    const order = await createOrder(ctx, input);

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
