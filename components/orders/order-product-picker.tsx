'use client';

/**
 * The product picker for the order builder.
 *
 * A searchable list of everything active in the catalogue, one row per orderable unit — a
 * product, or a specific size. Clicking a row adds it to the order; the running quantity
 * shows on the row so it is clear what is already in. Search filters the embedded list in
 * the browser, so it stays instant; a catalogue larger than the builder loads is narrowed
 * by name instead.
 *
 * The prices and stock counts here are for guidance. `createOrder` re-reads every price
 * from the database when the order is placed, so the figure a customer is charged never
 * comes from this list.
 */

import { PackageX, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SupportedCurrency } from '@/config/constants';
import { formatMoney, money } from '@/lib/money';
import type { OrderableOption, OrderableProduct } from '@/server/services/order/order.service';

function stockLabel(available: number | null): { text: string; variant: 'muted' | 'warning' | 'danger' | 'success' } {
  if (available === null) return { text: 'Made to order', variant: 'muted' };
  if (available <= 0) return { text: 'Out of stock', variant: 'danger' };
  if (available <= 5) return { text: `${available} left`, variant: 'warning' };
  return { text: `${available} in stock`, variant: 'success' };
}

export function OrderProductPicker({
  products,
  currency,
  truncated,
  selected,
  onAdd,
}: {
  products: OrderableProduct[];
  currency: SupportedCurrency;
  truncated: boolean;
  /** Option key → quantity already in the order, so a row can show what is added. */
  selected: Record<string, number>;
  onAdd: (option: OrderableOption) => void;
}) {
  const [query, setQuery] = useState('');

  // Flatten to options once; the label already carries the product name, so a size and its
  // product read as one line ("Black Kurta — Large") and search matches either.
  const options = useMemo(() => products.flatMap((product) => product.options), [products]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(term) ||
        (option.sku ? option.sku.toLowerCase().includes(term) : false),
    );
  }, [options, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <label className="sr-only" htmlFor="order-product-search">
          Search products to add
        </label>
        <Input
          id="order-product-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search products by name or code"
          className="ps-9"
          autoComplete="off"
        />
      </div>

      {truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {products.length} products. If you don&apos;t see one, search for it by
          name.
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
          <PackageX className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {options.length === 0
              ? 'No active products yet. Add a product to your catalogue first.'
              : 'No products match your search.'}
          </p>
        </div>
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {filtered.map((option) => {
            const stock = stockLabel(option.available);
            const inOrder = selected[option.key] ?? 0;
            const soldOut = option.available !== null && option.available <= 0;

            return (
              <li key={option.key} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{option.label}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatMoney(money(option.unitPriceMinor, currency))}</span>
                    <Badge variant={stock.variant}>{stock.text}</Badge>
                  </div>
                </div>
                {inOrder > 0 ? (
                  <span className="text-xs font-medium text-muted-foreground">{inOrder} added</span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={soldOut}
                  onClick={() => onAdd(option)}
                >
                  <Plus className="size-4" aria-hidden />
                  Add
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
