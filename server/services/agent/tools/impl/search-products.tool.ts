import 'server-only';

import { z } from 'zod';
import { prisma } from '@/db/prisma';
import type { AITenantContext } from '../../context';
import type { AITool } from '../tool-contract';
import { listProducts, type ProductFilters } from '@/server/repositories/product.repository';

export interface SearchProductsItemDTO {
  id: string;
  name: string;
  sku?: string;
  description?: string;
  priceMinor: number;
  salePriceMinor?: number;
  currency: string;
  categoryName?: string;
  trackInventory: boolean;
  variantCount: number;
  stockAvailable: number;
}

export interface SearchProductsResultDTO {
  results: SearchProductsItemDTO[];
  totalReturned: number;
}

export const searchProductsTool: AITool<
  { query: string; limit?: number },
  SearchProductsResultDTO | { error: string; message: string }
> = {
  name: 'search_products',
  description:
    'Search the active product catalog by keyword for customer-facing product discovery. Returns a summarized list of matching active products with authoritative prices and variant counts.',
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .min(1, 'Search query must be at least 1 character')
      .max(50, 'Search query cannot exceed 50 characters')
      .describe('Search query keyword (e.g. "kurta", "blue shirt")'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(3)
      .describe('Maximum number of products to return (1-5, default 3)'),
  }),
  classification: 'READ',
  capabilityRequired: 'products:read',
  sideEffect: 'NONE',
  idempotency: 'SAFE_TO_RETRY',
  riskLevel: 'LOW',
  auditRequired: false,
  handler: async (ctx: AITenantContext, input) => {
    const filters: ProductFilters = {
      search: input.query,
      status: 'ACTIVE',
      limit: input.limit ?? 3,
    };

    const page = await listProducts(prisma, ctx.workspaceId, filters);

    if (page.rows.length === 0) {
      return { error: 'NOT_FOUND', message: 'No active products found matching the query.' };
    }

    const summarized: SearchProductsItemDTO[] = page.rows.map((p) => {
      let shortDesc: string | undefined = undefined;
      if (p.description) {
        shortDesc =
          p.description.length > 150 ? p.description.slice(0, 147) + '...' : p.description;
      }

      return {
        id: p.id,
        name: p.name,
        sku: p.sku ?? undefined,
        description: shortDesc,
        priceMinor: p.priceMinor,
        salePriceMinor: p.salePriceMinor ?? undefined,
        currency: p.currency,
        categoryName: p.categoryName ?? undefined,
        trackInventory: p.trackInventory,
        variantCount: p.variantCount,
        stockAvailable: p.stock.reduce((sum, s) => sum + s.available, 0),
      };
    });

    return {
      results: summarized,
      totalReturned: summarized.length,
    };
  },
};
