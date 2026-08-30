import 'server-only';

import { z } from 'zod';
import { prisma } from '@/db/prisma';
import type { AITenantContext } from '../../context';
import type { AITool } from '../tool-contract';
import { findProductDetail } from '@/server/repositories/product.repository';

export interface ProductVariantDTO {
  id: string;
  name?: string;
  sku?: string;
  size?: string;
  color?: string;
  priceMinor: number;
  salePriceMinor?: number;
  stockAvailable: number;
}

export interface GetProductResultDTO {
  id: string;
  name: string;
  sku?: string;
  description?: string;
  priceMinor: number;
  salePriceMinor?: number;
  currency: string;
  categoryName?: string;
  trackInventory: boolean;
  weightGrams?: number;
  variants: ProductVariantDTO[];
  baseStockAvailable: number;
}

export const getProductTool: AITool<
  { productId: string },
  GetProductResultDTO | { error: string; message: string }
> = {
  name: 'get_product',
  description:
    'Retrieve full details and active variants for a specific active product using its unique ID.',
  inputSchema: z.object({
    productId: z
      .string()
      .uuid('productId must be a valid UUID')
      .describe('The UUID of the product to retrieve'),
  }),
  classification: 'READ',
  capabilityRequired: 'products:read',
  sideEffect: 'NONE',
  idempotency: 'SAFE_TO_RETRY',
  riskLevel: 'LOW',
  auditRequired: false,
  handler: async (ctx: AITenantContext, input) => {
    const product = await findProductDetail(prisma, ctx.workspaceId, input.productId);

    if (!product || product.status !== 'ACTIVE') {
      return { error: 'NOT_FOUND', message: 'Product not found or not active.' };
    }

    let description: string | undefined = undefined;
    if (product.description) {
      description =
        product.description.length > 500
          ? product.description.slice(0, 497) + '...'
          : product.description;
    }

    const activeVariants: ProductVariantDTO[] = product.variants
      .filter((v) => v.status === 'ACTIVE')
      .map((v) => {
        const variantStock = product.stock.find((s) => s.variantId === v.id);
        return {
          id: v.id,
          name: v.name ?? undefined,
          sku: v.sku ?? undefined,
          size: v.size ?? undefined,
          color: v.color ?? undefined,
          priceMinor: v.priceMinor ?? product.priceMinor,
          salePriceMinor: v.salePriceMinor ?? product.salePriceMinor ?? undefined,
          stockAvailable: variantStock?.available ?? 0,
        };
      });

    const baseStock = product.stock.find((s) => s.variantId === null)?.available ?? 0;

    return {
      id: product.id,
      name: product.name,
      sku: product.sku ?? undefined,
      description,
      priceMinor: product.priceMinor,
      salePriceMinor: product.salePriceMinor ?? undefined,
      currency: product.currency,
      categoryName: product.categoryName ?? undefined,
      trackInventory: product.trackInventory,
      weightGrams: product.weightGrams ?? undefined,
      variants: activeVariants,
      baseStockAvailable: baseStock,
    };
  },
};
