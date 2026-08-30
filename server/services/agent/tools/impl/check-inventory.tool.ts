import 'server-only';

import { z } from 'zod';
import { prisma } from '@/db/prisma';
import type { AITenantContext } from '../../context';
import type { AITool } from '../tool-contract';
import { findStock } from '@/server/repositories/inventory.repository';

export type InventoryAvailabilityStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface CheckInventoryResultDTO {
  productId: string;
  variantId: string | null;
  available: number;
  status: InventoryAvailabilityStatus;
}

export const checkInventoryTool: AITool<
  { productId: string; variantId?: string },
  CheckInventoryResultDTO | { error: string; message: string }
> = {
  name: 'check_inventory',
  description:
    'Check authoritative real-time inventory availability for a product or a specific variant.',
  inputSchema: z.object({
    productId: z
      .string()
      .uuid('productId must be a valid UUID')
      .describe('The UUID of the product'),
    variantId: z
      .string()
      .uuid('variantId must be a valid UUID')
      .optional()
      .describe('Optional UUID of the product variant'),
  }),
  classification: 'READ',
  capabilityRequired: 'inventory:read',
  sideEffect: 'NONE',
  idempotency: 'SAFE_TO_RETRY',
  riskLevel: 'LOW',
  auditRequired: false,
  handler: async (ctx: AITenantContext, input) => {
    const targetVariantId = input.variantId ?? null;

    const stock = await findStock(prisma, ctx.workspaceId, input.productId, targetVariantId);

    if (!stock) {
      return {
        error: 'NOT_FOUND',
        message: 'No inventory record found for the specified product or variant.',
      };
    }

    let status: InventoryAvailabilityStatus = 'IN_STOCK';
    if (stock.available <= 0) {
      status = 'OUT_OF_STOCK';
    } else if (stock.available <= stock.lowStockThreshold) {
      status = 'LOW_STOCK';
    }

    return {
      productId: stock.productId,
      variantId: stock.variantId,
      available: stock.available,
      status,
    };
  },
};
