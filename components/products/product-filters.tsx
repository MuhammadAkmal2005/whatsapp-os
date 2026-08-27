'use client';

/**
 * The catalogue's filters.
 *
 * State lives in the URL, not in this component — the same choice `ContactFilters`
 * makes and for the same three payoffs a shop owner notices: the back button works, a
 * filtered view can be sent to a colleague over WhatsApp, and a refresh does not throw
 * the filter away. The server does the filtering, so a catalogue of 4,000 products
 * filters no slower than one of 40.
 *
 * Every change clears the cursor. Page 2 of "all products" is not page 2 of "low stock
 * only", and keeping the cursor would show an empty page and look broken.
 */

import { Search, TriangleAlert, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  PRODUCT_FIELD_MAX,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
} from '@/server/validation/product';

/** Long enough that normal typing produces one request per word rather than one per
 *  keystroke, short enough that it does not feel laggy. */
const SEARCH_DEBOUNCE_MS = 350;

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

type Category = { id: string; name: string };

/**
 * Applies a set of filter changes and always drops the cursor.
 *
 * A module-level pure function rather than a closure, so the debounce effect can call
 * it without taking a dependency that changes on every render.
 */
function withChanges(
  params: URLSearchParams,
  changes: Record<string, string | null>,
): URLSearchParams {
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') params.delete(key);
    else params.set(key, value);
  }
  params.delete('cursor');
  return params;
}

export function ProductFilters({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentSearch = params.get('search') ?? '';
  const [search, setSearch] = useState(currentSearch);

  // Keeps the box in step when the URL changes from outside this component — the back
  // button, or the "clear" button below.
  useEffect(() => {
    setSearch(currentSearch);
  }, [currentSearch]);

  function apply(changes: Record<string, string | null>) {
    const query = withChanges(new URLSearchParams(params.toString()), changes).toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  // Debounced search. The query string is re-read from `window.location` when the timer
  // fires rather than captured now, so a status change made mid-typing is not reverted
  // by a search request that set out before it.
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === currentSearch) return;
    const timer = window.setTimeout(() => {
      const query = withChanges(new URLSearchParams(window.location.search), {
        search: trimmed || null,
      }).toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, currentSearch, pathname, router, startTransition]);

  const status = params.get('status') ?? '';
  const categoryId = params.get('categoryId') ?? '';
  const lowStock = params.get('lowStock') === 'true';
  const hasFilters = Boolean(currentSearch || status || categoryId || lowStock);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <label className="sr-only" htmlFor="product-search">
          Search products
        </label>
        <Input
          id="product-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or code"
          className="ps-9"
          maxLength={PRODUCT_FIELD_MAX.search}
          autoComplete="off"
        />
        {pending ? (
          <Spinner className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="product-status-filter">
          Filter by status
        </label>
        <select
          id="product-status-filter"
          value={status}
          onChange={(event) => apply({ status: event.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {PRODUCT_STATUS_LABELS[value]}
            </option>
          ))}
        </select>

        {categories.length > 0 ? (
          <>
            <label className="sr-only" htmlFor="product-category-filter">
              Filter by category
            </label>
            <select
              id="product-category-filter"
              value={categoryId}
              onChange={(event) => apply({ categoryId: event.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </>
        ) : null}

        {/* A toggle rather than a select: "what am I about to run out of?" is a yes/no
            question, and a two-option dropdown for it would be busywork. `aria-pressed`
            carries the on/off state to a screen reader that a colour change alone does
            not. */}
        <Button
          type="button"
          variant={lowStock ? 'default' : 'outline'}
          size="sm"
          aria-pressed={lowStock}
          onClick={() => apply({ lowStock: lowStock ? null : 'true' })}
        >
          <TriangleAlert className="size-4" aria-hidden />
          Low stock
        </Button>

        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => apply({ search: null, status: null, categoryId: null, lowStock: null })}
          >
            <X className="size-4" aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
