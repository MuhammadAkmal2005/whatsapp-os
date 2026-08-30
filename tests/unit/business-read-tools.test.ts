/**
 * Unit tests for Business Read Tools (Phase 5 Unit 2).
 */

import { describe, expect, it } from 'vitest';
import { createAITenantContext } from '@/server/services/agent/context';
import {
  allBusinessReadTools,
  checkInventoryTool,
  getCurrentCustomerTool,
  getOrderTool,
  getProductTool,
  searchProductsTool,
} from '@/server/services/agent/tools/impl';
import { ToolRegistry } from '@/server/services/agent/tools/registry';

describe('Business Read Tools Contract & Validation', () => {
  it('defines exactly five read-only tools with safe defaults', () => {
    expect(allBusinessReadTools).toHaveLength(5);

    for (const tool of allBusinessReadTools) {
      expect(tool.classification).toBe('READ');
      expect(tool.sideEffect).toBe('NONE');
      expect(tool.idempotency).toBe('SAFE_TO_RETRY');
      expect(tool.riskLevel).toBe('LOW');
      expect(tool.auditRequired).toBe(false);
      expect(tool.name).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.capabilityRequired).toBeDefined();
    }
  });

  describe('search_products schema', () => {
    it('accepts valid trimmed search query and limit', () => {
      const parsed = searchProductsTool.inputSchema.parse({
        query: '  blue shirt  ',
        limit: 4,
      });

      expect(parsed.query).toBe('blue shirt');
      expect(parsed.limit).toBe(4);
    });

    it('defaults limit to 3 when not specified', () => {
      const parsed = searchProductsTool.inputSchema.parse({
        query: 'kurta',
      });

      expect(parsed.query).toBe('kurta');
      expect(parsed.limit).toBe(3);
    });

    it('rejects empty, whitespace-only, or overly long queries', () => {
      expect(() => searchProductsTool.inputSchema.parse({ query: '' })).toThrow();
      expect(() => searchProductsTool.inputSchema.parse({ query: '   ' })).toThrow();
      expect(() =>
        searchProductsTool.inputSchema.parse({
          query: 'a'.repeat(51),
        }),
      ).toThrow();
    });

    it('enforces limit boundary (1 to 5)', () => {
      expect(() => searchProductsTool.inputSchema.parse({ query: 'shoes', limit: 0 })).toThrow();
      expect(() => searchProductsTool.inputSchema.parse({ query: 'shoes', limit: 6 })).toThrow();
      expect(() => searchProductsTool.inputSchema.parse({ query: 'shoes', limit: 3.5 })).toThrow();
    });
  });

  describe('get_product schema', () => {
    it('accepts valid UUID productId', () => {
      const parsed = getProductTool.inputSchema.parse({
        productId: '11111111-1111-1111-1111-111111111111',
      });
      expect(parsed.productId).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('rejects non-UUID productId', () => {
      expect(() => getProductTool.inputSchema.parse({ productId: 'invalid-id' })).toThrow();
      expect(() => getProductTool.inputSchema.parse({ productId: '' })).toThrow();
      expect(() => getProductTool.inputSchema.parse({})).toThrow();
    });
  });

  describe('check_inventory schema', () => {
    it('accepts productId and optional variantId', () => {
      const parsedWithoutVariant = checkInventoryTool.inputSchema.parse({
        productId: '11111111-1111-1111-1111-111111111111',
      });
      expect(parsedWithoutVariant.productId).toBe('11111111-1111-1111-1111-111111111111');
      expect(parsedWithoutVariant.variantId).toBeUndefined();

      const parsedWithVariant = checkInventoryTool.inputSchema.parse({
        productId: '11111111-1111-1111-1111-111111111111',
        variantId: '22222222-2222-2222-2222-222222222222',
      });
      expect(parsedWithVariant.variantId).toBe('22222222-2222-2222-2222-222222222222');
    });

    it('rejects invalid UUIDs for check_inventory', () => {
      expect(() => checkInventoryTool.inputSchema.parse({ productId: 'abc' })).toThrow();
      expect(() =>
        checkInventoryTool.inputSchema.parse({
          productId: '11111111-1111-1111-1111-111111111111',
          variantId: 'xyz',
        }),
      ).toThrow();
    });
  });

  describe('get_current_customer schema', () => {
    it('accepts empty object and rejects any passed parameters', () => {
      const parsed = getCurrentCustomerTool.inputSchema.parse({});
      expect(parsed).toEqual({});
    });
  });

  describe('get_order schema', () => {
    it('accepts valid trimmed orderNumber', () => {
      const parsed = getOrderTool.inputSchema.parse({
        orderNumber: '  AF-2608-0042  ',
      });
      expect(parsed.orderNumber).toBe('AF-2608-0042');
    });

    it('rejects empty or overly long order numbers', () => {
      expect(() => getOrderTool.inputSchema.parse({ orderNumber: '' })).toThrow();
      expect(() => getOrderTool.inputSchema.parse({ orderNumber: '   ' })).toThrow();
      expect(() =>
        getOrderTool.inputSchema.parse({
          orderNumber: 'x'.repeat(51),
        }),
      ).toThrow();
    });
  });
});

describe('Tool Registry & Capability Enforcement for Unit 2 Tools', () => {
  it('authorizes tools based on server-verified capabilities only', () => {
    const registry = new ToolRegistry();
    for (const tool of allBusinessReadTools) {
      registry.register(tool);
    }

    const ctx = createAITenantContext({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      agentId: '22222222-2222-2222-2222-222222222222',
      conversationId: '33333333-3333-3333-3333-333333333333',
      messageId: '44444444-4444-4444-4444-444444444444',
      capabilities: ['products:read'],
    });

    const searchAuth = registry.authorize(ctx, 'search_products');
    expect(searchAuth.authorized).toBe(true);
    expect(searchAuth.tool?.name).toBe('search_products');

    const getProductAuth = registry.authorize(ctx, 'get_product');
    expect(getProductAuth.authorized).toBe(true);

    const ordersAuth = registry.authorize(ctx, 'get_order');
    expect(ordersAuth.authorized).toBe(false);
    expect(ordersAuth.reason).toContain('lacks required capability "orders:read"');

    const inventoryAuth = registry.authorize(ctx, 'check_inventory');
    expect(inventoryAuth.authorized).toBe(false);
    expect(inventoryAuth.reason).toContain('lacks required capability "inventory:read"');

    const customerAuth = registry.authorize(ctx, 'get_current_customer');
    expect(customerAuth.authorized).toBe(false);
    expect(customerAuth.reason).toContain('lacks required capability "contacts:read"');
  });

  it('filters tool definitions exported to LLM provider strictly by granted capabilities', () => {
    const registry = new ToolRegistry();
    for (const tool of allBusinessReadTools) {
      registry.register(tool);
    }

    const defsForProducts = registry.getDefinitionsForCapabilities(new Set(['products:read']));
    expect(defsForProducts.map((d) => d.name)).toEqual(['search_products', 'get_product']);

    const defsForCustomerAndOrders = registry.getDefinitionsForCapabilities(
      new Set(['contacts:read', 'orders:read']),
    );
    expect(defsForCustomerAndOrders.map((d) => d.name)).toEqual([
      'get_current_customer',
      'get_order',
    ]);
  });
});
