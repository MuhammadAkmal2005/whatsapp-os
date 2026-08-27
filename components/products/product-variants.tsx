'use client';

/**
 * The sizes-and-colours section of the product page.
 *
 * A product may have none — a one-off with a single option — so this is not a table that
 * looks broken when empty but a section that explains what a size is for and offers to add
 * the first. Once there are variants, each is its own card with its own stock, and the
 * product-level stock control disappears (the parent page decides that): a kurta with an S
 * and an M is counted per size, and a product-level figure on top of that would be a number
 * the shop does not have.
 */

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { VariantCard } from '@/components/products/variant-card';
import { VariantForm } from '@/components/products/variant-form';
import { Button } from '@/components/ui/button';
import type { SupportedCurrency } from '@/config/constants';
import type { ProductVariantView } from '@/server/services/product/product.service';

export function ProductVariants({
  productId,
  variants,
  currency,
  tracksStock,
  canEditVariants,
  canEditStock,
}: {
  productId: string;
  variants: ProductVariantView[];
  currency: SupportedCurrency;
  tracksStock: boolean;
  canEditVariants: boolean;
  canEditStock: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Sizes &amp; colours</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a row for each size or colour you stock, so your AI can tell a customer exactly
            what is available.
          </p>
        </div>
        {canEditVariants && !adding ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            Add size
          </Button>
        ) : null}
      </div>

      {variants.length > 0 ? (
        <div className="flex flex-col gap-3">
          {variants.map((variant) => (
            <VariantCard
              key={variant.id}
              productId={productId}
              variant={variant}
              currency={currency}
              tracksStock={tracksStock}
              canEditVariants={canEditVariants}
              canEditStock={canEditStock}
            />
          ))}
        </div>
      ) : !adding ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {canEditVariants
            ? 'No sizes yet. Add one for each size or colour you sell, or leave this empty if it comes in just one.'
            : 'This product comes in a single option.'}
        </p>
      ) : null}

      {adding ? (
        <div className="rounded-lg border border-border p-4">
          <VariantForm
            productId={productId}
            currency={currency}
            mode="create"
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}
    </section>
  );
}
