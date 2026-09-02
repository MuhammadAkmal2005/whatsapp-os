import Link from 'next/link';

import { ProductPrice, ProductStatusBadge, StockBadge } from '@/components/products/product-badges';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ProductSummary } from '@/server/services/product/product.service';

/**
 * The catalogue.
 *
 * This was a list of stacked rows, on the argument that a table cannot work on a phone.
 * That argument gave up something real: a catalogue is scanned down a column — every price
 * against every other price, every stock level against every other — and stacked rows put
 * each product's figures at a different horizontal position, so the comparison the screen
 * exists for has to be done by reading rather than by looking.
 *
 * Below `md` two columns are drawn — what it is and what it costs — and the code, category,
 * size count, stock and status fold into the first cell. From `md` up each of those gets its
 * own column and the folded line drops away, so no fact is ever drawn twice and nothing
 * visible on a phone disappears on a laptop. The size count stays in the first cell at every
 * width as a quiet second line: it qualifies the product's name rather than standing beside
 * it, and the same holds for the item count on an order and the owner on a customer.
 *
 * A server component: nothing here is interactive, so none of it ships as JavaScript.
 */
export function ProductList({ products }: { products: ProductSummary[] }) {
  return (
    <TableContainer>
      <Table aria-label="Products">
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="hidden md:table-cell">Code</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead numeric>Price</TableHead>
            <TableHead className="hidden md:table-cell">Stock</TableHead>
            <TableHead className="hidden md:table-cell">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** "4 sizes", or nothing at all for a product sold as a single item. */
function sizeCount(product: ProductSummary): string | null {
  if (product.variantCount === 0) return null;
  return `${product.variantCount} ${product.variantCount === 1 ? 'size' : 'sizes'}`;
}

function ProductRow({ product }: { product: ProductSummary }) {
  const sizes = sizeCount(product);

  // The facts that have no column of their own below `md`. A product may have none of them
  // — a one-off with no code, no category and no variants — so there is a fallback rather
  // than an empty line that leaves rows at uneven heights.
  const folded = [product.sku, product.categoryName, sizes].filter(Boolean).join(' · ');

  return (
    // `relative` so the name's stretched overlay covers this row and nothing wider. Any
    // control added to a row later needs `relative z-10` to sit above that overlay.
    <TableRow interactive className="relative">
      <TableCell>
        <Link
          href={`/products/${product.id}`}
          // The overlay makes the whole row the click target while the focus ring stays
          // around the name, so a keyboard reader sees a word highlighted rather than a
          // rectangle the width of the screen.
          className="font-medium text-foreground after:absolute after:inset-0 after:content-['']"
        >
          {product.name}
        </Link>

        {/* Wraps rather than truncates. A table cell sizes to its content, so a clamped
            width here would be a guess, and on a phone a second line of code-and-category
            costs less than hiding what the reader came to check. */}
        <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">
          {folded || 'No code or category yet'}
        </span>
        {sizes ? (
          <span className="mt-0.5 hidden text-xs text-muted-foreground md:block">{sizes}</span>
        ) : null}

        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 md:hidden">
          <StockBadge
            tracksStock={product.tracksStock}
            totalAvailable={product.totalAvailable}
            isLowStock={product.isLowStock}
          />
          <ProductStatusBadge status={product.status} />
        </span>
      </TableCell>

      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
        {product.sku ?? <span className="font-sans">Not set</span>}
      </TableCell>

      <TableCell className="hidden text-muted-foreground md:table-cell">
        {product.categoryName ?? 'Uncategorised'}
      </TableCell>

      <TableCell numeric>
        <ProductPrice price={product.price} className="flex justify-end" />
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <StockBadge
          tracksStock={product.tracksStock}
          totalAvailable={product.totalAvailable}
          isLowStock={product.isLowStock}
        />
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <ProductStatusBadge status={product.status} />
      </TableCell>
    </TableRow>
  );
}
