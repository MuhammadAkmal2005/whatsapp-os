'use client';

/**
 * The conversation list pane.
 *
 * A search field, a status filter, and the rows — in that order, because that is the order a
 * shop owner uses them in. Three things were rebuilt rather than restyled.
 *
 * Search is debounced instead of waiting for Enter. The old field looked live and was not,
 * so typing a customer's name appeared to do nothing.
 *
 * The status filter is one segmented control rather than five loose buttons, and its counts
 * are shown only when they are true. `statusCounts` and `total` are counted across the whole
 * workspace, ignoring the search term and the assignee filter — so a number beside "Open"
 * while a search is active describes a different set from the rows underneath it, and for a
 * teammate who can only see their own conversations it describes a set they cannot see at
 * all. Both cases hide the numbers rather than print a plausible wrong one.
 *
 * And a filter change now shows that it is working. Previously only the pagination button
 * knew about `isPending`, so changing status looked frozen for the length of a round trip.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessageSquare, Plus, Search, SearchX, X } from 'lucide-react';

import { ConversationListItem } from './conversation-list-item';
import { MockSimulatorDialog } from './mock-simulator-dialog';
import { NewConversationDialog } from './new-conversation-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import type { ConversationListPage } from '@/server/services/conversation/conversation.service';
import { CONVERSATION_STATUSES, type ConversationStatus } from '@/server/validation/conversation';

type StatusFilter = 'ALL' | ConversationStatus;

const STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: 'Open',
  PENDING: 'Pending',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/** Long enough to finish a word, short enough that the list feels attached to the keyboard. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * The service reads this exact string as "conversations nobody has picked up", so it is not
 * an id and must not be passed through anything that expects one.
 */
const UNASSIGNED = 'unassigned';

export function ConversationList({
  page,
  selectedId,
  assignees,
  contacts,
  now,
}: {
  page: ConversationListPage;
  selectedId?: string | null;
  assignees: { id: string; name: string }[];
  contacts: { id: string; name: string | null; phoneE164: string }[];
  now: Date;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // A stable string, so the debounce effect below can depend on the query without depending
  // on an object identity that changes on every render.
  const query = searchParams.toString();

  const activeSearch = searchParams.get('search') ?? '';
  const activeAssignee = searchParams.get('assignedTo') ?? '';
  const rawStatus = searchParams.get('status');
  const activeStatus: StatusFilter = CONVERSATION_STATUSES.includes(rawStatus as ConversationStatus)
    ? (rawStatus as ConversationStatus)
    : 'ALL';

  const [searchDraft, setSearchDraft] = useState(activeSearch);
  const [isNewDialogOpen, setNewDialogOpen] = useState(false);

  const applyFilters = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(query);

    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '' || value === 'ALL') params.delete(key);
      else params.set(key, value);
    }

    // A cursor belongs to the previous result set. Carrying it into a new filter would
    // page from a row that is no longer in the list.
    params.delete('cursor');

    startTransition(() => router.push(`/conversations?${params.toString()}`));
  };

  // Debounced search. The comparison against the URL is what stops this from pushing the
  // same query again after the navigation it just caused: once the push lands, `activeSearch`
  // equals the draft and the effect returns before setting another timer.
  useEffect(() => {
    if (searchDraft.trim() === activeSearch) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(query);
      const next = searchDraft.trim();

      if (next) params.set('search', next);
      else params.delete('search');
      params.delete('cursor');

      startTransition(() => router.push(`/conversations?${params.toString()}`));
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchDraft, activeSearch, query, router]);

  // Keeps the box in step with the back button, which changes the URL without touching state.
  useEffect(() => setSearchDraft(activeSearch), [activeSearch]);

  const isFiltered = Boolean(activeSearch || activeAssignee || activeStatus !== 'ALL');

  // See the note at the top of the file: the counts describe the whole workspace, so they
  // are only shown to someone who can see the whole workspace, and only when no other
  // filter is narrowing the rows they sit above.
  const showCounts = page.can.readAll && !activeSearch && !activeAssignee;

  const statusFilters: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'ALL', label: 'All', count: page.total },
    ...CONVERSATION_STATUSES.map((status) => ({
      id: status,
      label: STATUS_LABELS[status],
      count: page.statusCounts[status] ?? 0,
    })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col border-border bg-card md:border-r">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        {/* The page's own `<h1>Inbox</h1>` is in the shell, hidden, because on a phone this
            pane is removed from the layout while a thread is open. This names the pane. */}
        <h2 className="text-md font-semibold tracking-tight text-foreground">Conversations</h2>

        <div className="flex items-center gap-1.5">
          <MockSimulatorDialog />
          {page.can.create ? (
            <>
              <Button size="sm" onClick={() => setNewDialogOpen(true)}>
                <Plus aria-hidden />
                New chat
              </Button>
              <NewConversationDialog
                open={isNewDialogOpen}
                onOpenChange={setNewDialogOpen}
                contacts={contacts}
                assignees={assignees}
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <label htmlFor="inbox-search" className="sr-only">
            Search conversations
          </label>
          <Input
            id="inbox-search"
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search name or number"
            // `type="search"` earns the mobile keyboard's search key, but WebKit also draws
            // its own cancel glyph, which would sit underneath the clear button below it.
            className="px-9 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {searchDraft ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setSearchDraft('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      {/* One control, one row. `scrollbar-none` because a horizontal scrollbar under five
          chips is louder than the chips. */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div
          className="flex gap-0.5 overflow-x-auto rounded-md border border-border bg-surface-sunken p-0.5 scrollbar-none"
          role="group"
          aria-label="Filter by status"
        >
          {statusFilters.map((filter) => {
            const isActive = activeStatus === filter.id;

            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => applyFilters({ status: filter.id })}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-1',
                  'text-2xs font-medium transition-colors duration-instant ease-out',
                  isActive
                    ? 'bg-card text-foreground shadow-raised'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {filter.label}
                {showCounts && filter.count > 0 ? (
                  <span
                    className={cn(
                      'tabular-nums',
                      isActive ? 'text-muted-foreground' : 'text-muted-foreground/70',
                    )}
                  >
                    {filter.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Only worth a row when there is more than one person it could be assigned to. A
          one-person business would otherwise carry a permanent control with one option. */}
      {page.can.readAll && assignees.length > 1 ? (
        <div className="shrink-0 border-b border-border px-3 py-2">
          <label htmlFor="inbox-filter-assignee" className="sr-only">
            Filter by who it is assigned to
          </label>
          <NativeSelect
            id="inbox-filter-assignee"
            value={activeAssignee}
            onChange={(event) => applyFilters({ assignedTo: event.target.value })}
            className="h-control-sm text-xs"
          >
            <option value="">Anyone on the team</option>
            <option value={UNASSIGNED}>Nobody yet</option>
            {assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto scrollbar-thin',
          'transition-opacity duration-fast ease-out',
          isPending && 'opacity-60',
        )}
        aria-busy={isPending}
      >
        {page.conversations.length > 0 ? (
          page.conversations.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              isSelected={conversation.id === selectedId}
              now={now}
            />
          ))
        ) : isFiltered ? (
          <EmptyState
            icon={SearchX}
            title="Nothing matches those filters"
            description="Try a different name or number, or widen the status filter."
            variant="plain"
            size="compact"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchDraft('');
                  applyFilters({ search: null, status: null, assignedTo: null });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="No conversations yet"
            description="When a customer messages your WhatsApp number, their conversation appears here."
            variant="plain"
            size="compact"
            action={
              page.can.create ? (
                <Button size="sm" onClick={() => setNewDialogOpen(true)}>
                  Start a conversation
                </Button>
              ) : undefined
            }
          />
        )}
      </div>

      {page.nextCursor ? (
        <div className="shrink-0 border-t border-border px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            isLoading={isPending}
            onClick={() => applyFilters({ cursor: page.nextCursor })}
            className="w-full text-muted-foreground"
          >
            Load older conversations
          </Button>
        </div>
      ) : null}
    </div>
  );
}
