'use client';

/**
 * The automations list's filters.
 *
 * State lives in the URL for the same reasons the order book keeps it there: the back button
 * works, a filtered view survives a refresh, and the server does the filtering so a workspace
 * with two hundred rules narrows as fast as one with two.
 *
 * Every change drops the cursor. Page two of "all rules" is not page two of "only the ones
 * that are off", and keeping the cursor would show an empty page and look broken.
 */

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { triggerTypeLabel } from '@/lib/labels';
import { AUTOMATION_FIELD_MAX, TRIGGER_TYPES } from '@/server/validation/automation';

/** Long enough that typing a word produces one request, short enough not to feel laggy. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * Applies a set of filter changes and always drops the cursor.
 *
 * Module-level and pure, so the debounce effect can call it without taking a dependency that
 * changes on every render.
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

export function AutomationFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentSearch = params.get('search') ?? '';
  const [search, setSearch] = useState(currentSearch);

  // Keeps the box in step when the URL changes from outside this component — the back button,
  // or the clear button below.
  useEffect(() => {
    setSearch(currentSearch);
  }, [currentSearch]);

  function apply(changes: Record<string, string | null>) {
    const query = withChanges(new URLSearchParams(params.toString()), changes).toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  // The query string is re-read from `window.location` when the timer fires rather than
  // captured now, so a filter changed mid-typing is not reverted by a search request that set
  // out before it.
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

  const active = params.get('active') ?? '';
  const triggerType = params.get('triggerType') ?? '';
  const hasFilters = Boolean(currentSearch || active || triggerType);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <label className="sr-only" htmlFor="automation-search">
          Search automations
        </label>
        <Input
          id="automation-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name"
          className="ps-9"
          maxLength={AUTOMATION_FIELD_MAX.search}
          autoComplete="off"
        />
        {pending ? (
          <Spinner className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="automation-active-filter">
          Show rules that are on or off
        </label>
        <NativeSelect
          id="automation-active-filter"
          value={active}
          onChange={(event) => apply({ active: event.target.value })}
          wrapperClassName="w-auto"
        >
          <option value="">On and off</option>
          <option value="true">Only the ones that are on</option>
          <option value="false">Only the ones that are off</option>
        </NativeSelect>

        <label className="sr-only" htmlFor="automation-trigger-filter">
          Filter by what starts the rule
        </label>
        <NativeSelect
          id="automation-trigger-filter"
          value={triggerType}
          onChange={(event) => apply({ triggerType: event.target.value })}
          wrapperClassName="w-auto"
        >
          <option value="">Any trigger</option>
          {TRIGGER_TYPES.map((value) => (
            <option key={value} value={value}>
              When {triggerTypeLabel(value)}
            </option>
          ))}
        </NativeSelect>

        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => apply({ search: null, active: null, triggerType: null })}
          >
            <X aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
