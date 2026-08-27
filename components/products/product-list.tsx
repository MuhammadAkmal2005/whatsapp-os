import { Package } from 'lucide-react';
import Link from 'next/link';

import { ProductPrice, ProductStatusBadge, StockBadge } from '@/components/products/product-badges';
import type { ProductSummary } from '@/server/services/product/product.service';

/**
 * The catalogue.
 *
 * Rows, not a table, for the reason `ContactList` gives: a table of a product's name,
 * code, category, price and stock either scrolls sideways on a phone or shrinks its text
 * past reading. Each row is one link into the product, with the two things a shop owner
 * scans a catalogue for held at the end where the eye lands — what it costs and whether
 * it is about to run out.
 *
 * A server component: nothing here is interactive, so none of it ships as JavaScript.
 */
export function ProductList({ products }: { products: ProductSummary[] }) {
  return (
    <ul className="divide-y divide-border">
      {products.map((product) => (
        <ProductRow key={product.id} product={product} />
      ))}
    </ul>
  );
}

/**
 * The secondary line: code, category and how many sizes, joined only when present.
 *
 * A product may have none of the three — a one-off with no code, no category and no
 * variants — so the line falls back to a quiet hint rather than rendering empty and
 * leaving rows at uneven heights.
 */
function metaParts(product: ProductSummary): string[] {
  const parts: string[] = [];
  if (product.sku) parts.push(product.sku);
  if (product.categoryName) parts.push(product.categoryName);
  if (product.variantCount > 0) {
    parts.push(`${product.variantCount} ${product.variantCount === 1 ? 'size' : 'sizes'}`);
  }
  return parts;
}

function ProductRow({ product }: { product: ProductSummary }) {
  const meta = metaParts(product);

  return (
    <li>
      <Link
        href={`/products/${product.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-6"
      >
        {/* A neutral tile, not a photo. The list summary carries no image, and a broken
            thumbnail would read worse than an honest placeholder. */}
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden
        >
          <Package className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">{product.name}</span>
            <ProductStatusBadge status={product.status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {meta.length > 0 ? meta.join(' · ') : 'No code or category yet'}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5 text-end">
          <ProductPrice price={product.price} />
          <StockBadge
            tracksStock={product.tracksStock}
            totalAvailable={product.totalAvailable}
            isLowStock={product.isLowStock}
          />
        </div>
      </Link>
    </li>
  );
}
