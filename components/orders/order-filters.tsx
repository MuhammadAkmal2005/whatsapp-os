'use client';

/**
 * The order book's filters.
 *
 * State lives in the URL, not in this component — the same choice `ProductFilters` makes
 * and for the same payoffs a shop owner notices: the back button works, a filtered view
 * can be sent to a colleague over WhatsApp, and a refresh does not throw the filter away.
 * The server does the filtering, so a book of 4,000 orders filters no slower than one of
 * 40.
 *
 * Every change clears the cursor. Page 2 of "all orders" is not page 2 of "pending only",
 * and keeping the cursor would show an empty page and look broken.
 */

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ORDER_FIELD_MAX,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
} from '@/server/validation/order';

/** Long enough that normal typing produces one request per word rather than one per
 *  keystroke, short enough that it does not feel laggy. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * Applies a set of filter changes and always drops the cursor.
 *
 * A module-level pure function rather than a closure, so the debounce effect can call it
 * without taking a dependency that changes on every render.
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

export function OrderFilters() {
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
  // fires rather than captured now, so a status change made mid-typing is not reverted by
  // a search request that set out before it.
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
  const paymentStatus = params.get('paymentStatus') ?? '';
  const hasFilters = Boolean(currentSearch || status || paymentStatus);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <label className="sr-only" htmlFor="order-search">
          Search orders
        </label>
        <Input
          id="order-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by order number, customer or phone"
          className="ps-9"
          maxLength={ORDER_FIELD_MAX.search}
          autoComplete="off"
        />
        {pending ? (
          <Spinner className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="order-status-filter">
          Filter by status
        </label>
        <NativeSelect
          id="order-status-filter"
          value={status}
          onChange={(event) => apply({ status: event.target.value })}
          wrapperClassName="w-auto"
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {ORDER_STATUS_LABELS[value]}
            </option>
          ))}
        </NativeSelect>

        <label className="sr-only" htmlFor="order-payment-filter">
          Filter by payment
        </label>
        <NativeSelect
          id="order-payment-filter"
          value={paymentStatus}
          onChange={(event) => apply({ paymentStatus: event.target.value })}
          wrapperClassName="w-auto"
        >
          <option value="">All payments</option>
          {PAYMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {PAYMENT_STATUS_LABELS[value]}
            </option>
          ))}
        </NativeSelect>

        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => apply({ search: null, status: null, paymentStatus: null })}
          >
            <X className="size-4" aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
