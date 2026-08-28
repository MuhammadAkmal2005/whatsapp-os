/**
 * Product service integration tests.
 *
 * Verifies core Product, Variant, and Inventory behaviors against a real PostgreSQL database:
 * - Product creation, reading, and listing with workspace scoping
 * - Variant creation, reading, and management
 * - Initial stock and inventory adjustments (setStock, adjustStock, low stock threshold)
 * - Stock invariants (cannot reduce stock below zero / cannot adjust beyond available)
 * - Cross-tenant isolation (Workspace B cannot read or modify Workspace A products/variants)
 * - Soft-deletion behavior (softDelete preserves row for historical integrity)
 * - Role-based authorization & permission enforcement
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@/db/prisma';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '@/server/errors';
import {
  createProduct,
  deleteProduct,
  getProduct,
  getProducts,
  setProductStatus,
  updateProduct,
} from '@/server/services/product/product.service';
import {
  adjustStock,
  getStockForProduct,
  setLowStockThreshold,
  setStock,
} from '@/server/services/product/stock.service';
import {
  createVariant,
  deleteVariant,
  updateVariant,
} from '@/server/services/product/variant.service';
import type {
  CreateProductInput,
  CreateVariantInput,
} from '@/server/validation/product';
import {
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
  type WorkspaceFixture,
} from '../fixtures';

describe('Product service integration tests', () => {
  let workspaceA: WorkspaceFixture;
  let workspaceB: WorkspaceFixture;

  beforeEach(async () => {
    await resetDatabase();
    workspaceA = await createWorkspaceFixture({ name: 'Akmal Apparel' });
    workspaceB = await createWorkspaceFixture({ name: 'Lahore Fabrics' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Product creation and retrieval', () => {
    it('creates a product with initial stock and retrieves details', async () => {
      const input: CreateProductInput = {
        name: 'Classic Black Kurta',
        sku: 'KURTA-BLK-01',
        categoryId: null,
        priceMinor: '4500', // Rs. 4,500
        salePriceMinor: '3999', // Rs. 3,999
        description: 'Premium Egyptian cotton embroidered kurta.',
        status: 'ACTIVE',
        trackInventory: true,
        initialStock: 25,
        lowStockThreshold: 5,
      };

      const created = await createProduct(workspaceA.context, input);
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Classic Black Kurta');
      expect(created.sku).toBe('KURTA-BLK-01');
      expect(created.price.effective.minor).toBe(399900); // Converted to paisa
      expect(created.price.list.minor).toBe(450000);
      expect(created.price.isDiscounted).toBe(true);
      expect(created.totalAvailable).toBe(25);
      expect(created.isLowStock).toBe(false);

      // Verify retrieval
      const fetched = await getProduct(workspaceA.context, created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe(created.name);
      expect(fetched.ownStock?.available).toBe(25);
    });

    it('lists products scoped to the workspace and handles filters', async () => {
      await createProduct(workspaceA.context, {
        name: 'Kurta Alpha',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '2000',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
        initialStock: 10,
      });

      await createProduct(workspaceA.context, {
        name: 'Kurta Beta',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '3000',
        salePriceMinor: null,
        status: 'DRAFT',
        trackInventory: true,
        initialStock: 2,
        lowStockThreshold: 5, // low stock!
      });

      const listAll = await getProducts(workspaceA.context, { search: null, lowStock: false, limit: 20 });
      expect(listAll.products).toHaveLength(2);
      expect(listAll.statusCounts['ACTIVE']).toBe(1);
      expect(listAll.statusCounts['DRAFT']).toBe(1);

      // Filter by status
      const listActive = await getProducts(workspaceA.context, { search: null, lowStock: false, status: 'ACTIVE', limit: 20 });
      expect(listActive.products).toHaveLength(1);
      expect(listActive.products[0]?.name).toBe('Kurta Alpha');

      // Filter by low stock
      const listLowStock = await getProducts(workspaceA.context, { search: null, lowStock: true, limit: 20 });
      expect(listLowStock.products).toHaveLength(1);
      expect(listLowStock.products[0]?.name).toBe('Kurta Beta');
    });

    it('updates product fields and status', async () => {
      const created = await createProduct(workspaceA.context, {
        name: 'Lawn Shirt',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '1500',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
        initialStock: 10,
      });

      const updated = await updateProduct(workspaceA.context, {
        productId: created.id,
        name: 'Lawn Shirt Luxury',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '1800',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
      });

      expect(updated.name).toBe('Lawn Shirt Luxury');
      expect(updated.price.list.minor).toBe(180000);
      expect(updated.price.effective.minor).toBe(180000);
      expect(updated.price.isDiscounted).toBe(false);

      // Change status
      await setProductStatus(workspaceA.context, {
        productId: created.id,
        status: 'ARCHIVED',
      });

      const archived = await getProduct(workspaceA.context, created.id);
      expect(archived.status).toBe('ARCHIVED');
    });
  });

  describe('Variant management', () => {
    it('creates, updates, and deletes variants for a product', async () => {
      const product = await createProduct(workspaceA.context, {
        name: 'Embroidered Shawl',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '5000',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
      });

      const variantInput: CreateVariantInput = {
        productId: product.id,
        name: null,
        size: 'Medium',
        color: 'Maroon',
        sku: 'SHW-MRN-M',
        priceMinor: '5500', // variant price override
        salePriceMinor: null,
        status: 'ACTIVE',
        initialStock: 15,
      };

      const variant = await createVariant(workspaceA.context, variantInput);
      expect(variant.id).toBeDefined();
      expect(variant.size).toBe('Medium');
      expect(variant.color).toBe('Maroon');
      expect(variant.priceMinor).toBe(550000);

      // Verify product detail now reflects the variant and its stock
      const detail = await getProduct(workspaceA.context, product.id);
      expect(detail.variants).toHaveLength(1);
      expect(detail.variants[0]?.stock?.available).toBe(15);
      expect(detail.totalAvailable).toBe(15);

      // Update variant
      const updatedVariant = await updateVariant(workspaceA.context, {
        variantId: variant.id,
        name: null,
        size: 'Medium',
        color: 'Deep Maroon',
        sku: 'SHW-DMRN-M',
        priceMinor: '5800',
        salePriceMinor: null,
        status: 'ACTIVE',
      });
      expect(updatedVariant.color).toBe('Deep Maroon');
      expect(updatedVariant.priceMinor).toBe(580000);

      // Delete variant
      await deleteVariant(workspaceA.context, { variantId: variant.id });

      const detailAfterDelete = await getProduct(workspaceA.context, product.id);
      expect(detailAfterDelete.variants).toHaveLength(0);
    });
  });

  describe('Inventory & stock operations', () => {
    it('sets absolute stock and records low stock thresholds', async () => {
      const product = await createProduct(workspaceA.context, {
        name: 'Festive Kurti',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '2500',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
        initialStock: 10,
      });

      // Set stock directly (stocktake)
      const stock = await setStock(workspaceA.context, {
        productId: product.id,
        variantId: null,
        available: 30,
      });
      expect(stock.available).toBe(30);

      // Set threshold
      const updatedThreshold = await setLowStockThreshold(workspaceA.context, {
        productId: product.id,
        variantId: null,
        lowStockThreshold: 10,
      });
      expect(updatedThreshold.lowStockThreshold).toBe(10);
      expect(updatedThreshold.isLow).toBe(false);

      // Change available below threshold
      const lowStock = await setStock(workspaceA.context, {
        productId: product.id,
        variantId: null,
        available: 5,
      });
      expect(lowStock.isLow).toBe(true);
    });

    it('adjusts stock relatively and prevents driving inventory below zero', async () => {
      const product = await createProduct(workspaceA.context, {
        name: 'Silk Dupatta',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '1200',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
        initialStock: 10,
      });

      // Add stock (+5)
      const added = await adjustStock(workspaceA.context, {
        productId: product.id,
        variantId: null,
        delta: 5,
        reason: 'Shipment received from vendor',
      });
      expect(added.available).toBe(15);

      // Reduce stock (-10)
      const reduced = await adjustStock(workspaceA.context, {
        productId: product.id,
        variantId: null,
        delta: -10,
        reason: 'Damage write-off',
      });
      expect(reduced.available).toBe(5);

      // Invariant: cannot remove more than available (try -10 when available is 5)
      await expect(
        adjustStock(workspaceA.context, {
          productId: product.id,
          variantId: null,
          delta: -10,
          reason: 'Excess write-off',
        }),
      ).rejects.toThrow(BusinessRuleError);

      // Verify stock remained unchanged at 5
      const currentStock = await getStockForProduct(workspaceA.context, product.id);
      expect(currentStock[0]?.available).toBe(5);
    });
  });

  describe('Cross-tenant isolation', () => {
    it('prevents Workspace B from reading Workspace A products', async () => {
      const productA = await createProduct(workspaceA.context, {
        name: 'Confidential Design in A',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '10000',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
        initialStock: 5,
      });

      // Workspace B tries to read Workspace A product
      await expect(getProduct(workspaceB.context, productA.id)).rejects.toThrow(NotFoundError);

      // Workspace B list should not include Workspace A product
      const listB = await getProducts(workspaceB.context, { search: null, lowStock: false, limit: 20 });
      expect(listB.products.find((p) => p.id === productA.id)).toBeUndefined();
    });

    it('prevents Workspace B from modifying or deleting Workspace A products', async () => {
      const productA = await createProduct(workspaceA.context, {
        name: 'Product in A',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '3500',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
        initialStock: 8,
      });

      // Update attempt
      await expect(
        updateProduct(workspaceB.context, {
          productId: productA.id,
          name: 'Hacked Product Name',
          description: null,
          sku: null,
          categoryId: null,
          priceMinor: '1000',
          salePriceMinor: null,
          status: 'ACTIVE',
          trackInventory: true,
        }),
      ).rejects.toThrow(NotFoundError);

      // Delete attempt
      await expect(
        deleteProduct(workspaceB.context, {
          productId: productA.id,
        }),
      ).rejects.toThrow(NotFoundError);

      // Stock adjustment attempt
      await expect(
        adjustStock(workspaceB.context, {
          productId: productA.id,
          variantId: null,
          delta: -2,
          reason: null,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('prevents Workspace B from adding or manipulating variants of Workspace A products', async () => {
      const productA = await createProduct(workspaceA.context, {
        name: 'Product with Variants in A',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '4000',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
      });

      const variantInA = await createVariant(workspaceA.context, {
        productId: productA.id,
        name: null,
        size: 'Large',
        color: 'Navy',
        sku: 'NAVY-L-A',
        priceMinor: null,
        salePriceMinor: null,
        status: 'ACTIVE',
      });

      // Workspace B attempts to create variant on Workspace A product
      await expect(
        createVariant(workspaceB.context, {
          productId: productA.id,
          name: null,
          size: 'Small',
          color: 'Red',
          sku: 'RED-S-B',
          priceMinor: null,
          salePriceMinor: null,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow(NotFoundError);

      // Workspace B attempts to update Workspace A variant
      await expect(
        updateVariant(workspaceB.context, {
          variantId: variantInA.id,
          name: null,
          size: 'Extra Large',
          color: 'Navy',
          sku: 'NAVY-XL-A',
          priceMinor: null,
          salePriceMinor: null,
          status: 'ACTIVE',
        }),
      ).rejects.toThrow(NotFoundError);

      // Workspace B attempts to delete Workspace A variant
      await expect(
        deleteVariant(workspaceB.context, {
          variantId: variantInA.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Product soft-deletion & lifecycle', () => {
    it('soft-deletes product and hides it from standard list and get queries', async () => {
      const product = await createProduct(workspaceA.context, {
        name: 'Temporary Promo Item',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '999',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
        initialStock: 10,
      });

      await deleteProduct(workspaceA.context, { productId: product.id });

      // getProduct throws NotFoundError
      await expect(getProduct(workspaceA.context, product.id)).rejects.toThrow(NotFoundError);

      // List does not return it
      const list = await getProducts(workspaceA.context, { search: null, lowStock: false, limit: 20 });
      expect(list.products.find((p) => p.id === product.id)).toBeUndefined();

      // Row still exists in database with deletedAt timestamp
      const rawRow = await prisma.product.findUnique({ where: { id: product.id } });
      expect(rawRow).not.toBeNull();
      expect(rawRow?.deletedAt).not.toBeNull();
    });
  });

  describe('Authorization and permissions', () => {
    it('enforces RBAC permissions on product mutations', async () => {
      // Create a VIEWER member
      const viewerMember = await createMemberFixture(workspaceA.workspaceId, 'VIEWER', {
        name: 'Readonly Viewer',
      });

      const viewerCtx = tenantContextFor({
        workspaceId: workspaceA.workspaceId,
        workspaceSlug: workspaceA.workspaceSlug,
        workspaceName: 'Akmal Apparel',
        currency: 'PKR',
        userId: viewerMember.userId,
        userName: viewerMember.name,
        userEmail: viewerMember.email,
        membershipId: viewerMember.membershipId,
        role: 'VIEWER',
      });

      // Product creation forbidden for VIEWER
      await expect(
        createProduct(viewerCtx, {
          name: 'Forbidden Product',
          description: null,
          sku: null,
          categoryId: null,
          priceMinor: '1000',
          salePriceMinor: null,
          status: 'ACTIVE',
          trackInventory: true,
        }),
      ).rejects.toThrow(ForbiddenError);

      // Product created by OWNER can be read by VIEWER
      const product = await createProduct(workspaceA.context, {
        name: 'Viewable Product',
        description: null,
        sku: null,
        categoryId: null,
        priceMinor: '1000',
        salePriceMinor: null,
        status: 'ACTIVE',
        trackInventory: true,
      });

      const readDetail = await getProduct(viewerCtx, product.id);
      expect(readDetail.id).toBe(product.id);

      // Mutation forbidden for VIEWER
      await expect(
        updateProduct(viewerCtx, {
          productId: product.id,
          name: 'Renamed by viewer',
          description: null,
          sku: null,
          categoryId: null,
          priceMinor: '1000',
          salePriceMinor: null,
          status: 'ACTIVE',
          trackInventory: true,
        }),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
