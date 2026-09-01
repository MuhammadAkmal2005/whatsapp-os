'use client';

/**
 * Left conversation list pane.
 *
 * Provides live search, status filter tabs, assignment filtering, and list rendering
 * with pagination indicators.
 */

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessageSquare, Plus, Search, UserX, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConversationListItem } from './conversation-list-item';
import { MockSimulatorDialog } from './mock-simulator-dialog';
import { NewConversationDialog } from './new-conversation-dialog';
import type {
  ConversationListPage,
  ConversationSummary,
} from '@/server/services/conversation/conversation.service';
import type { ConversationStatus } from '@/server/validation/conversation';

type StatusTab = 'ALL' | ConversationStatus;

export function ConversationList({
  page,
  selectedId,
  assignees,
  contacts,
}: {
  page: ConversationListPage;
  selectedId?: string | null;
  assignees: { id: string; name: string }[];
  contacts: { id: string; name: string | null; phoneE164: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentSearch = searchParams.get('search') ?? '';
  const rawStatus = searchParams.get('status');
  const currentStatus: StatusTab =
    rawStatus === 'OPEN' || rawStatus === 'PENDING' || rawStatus === 'RESOLVED' || rawStatus === 'CLOSED'
      ? rawStatus
      : 'ALL';
  const currentAssignee = searchParams.get('assignedTo') ?? '';

  const [searchTerm, setSearchTerm] = useState(currentSearch);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const updateFilters = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '' || val === 'ALL') {
        params.delete(key);
      } else {
        params.set(key, val);
      }
    }
    // Remove pagination cursor when updating search or filters
    if ('search' in updates || 'status' in updates || 'assignedTo' in updates) {
      params.delete('cursor');
    }

    startTransition(() => {
      router.push(`/conversations?${params.toString()}`);
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ search: searchTerm.trim() || null });
  };

  const clearSearch = () => {
    setSearchTerm('');
    updateFilters({ search: null });
  };

  const statusCounts = page.statusCounts;
  const totalCount = page.total;

  const STATUS_TABS: { id: StatusTab; label: string; count?: number }[] = [
    { id: 'ALL', label: 'All', count: totalCount },
    { id: 'OPEN', label: 'Open', count: statusCounts['OPEN'] ?? 0 },
    { id: 'PENDING', label: 'Pending', count: statusCounts['PENDING'] ?? 0 },
    { id: 'RESOLVED', label: 'Resolved', count: statusCounts['RESOLVED'] ?? 0 },
    { id: 'CLOSED', label: 'Closed', count: statusCounts['CLOSED'] ?? 0 },
  ];

  const isFiltered = Boolean(currentSearch || (currentStatus && currentStatus !== 'ALL') || currentAssignee);

  return (
    <div className="flex h-full flex-col border-r bg-card/60">
      {/* Top Header */}
      <div className="flex items-center justify-between p-3.5 border-b gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">Inbox</h2>
          <p className="text-xs text-muted-foreground">
            {totalCount} {totalCount === 1 ? 'conversation' : 'conversations'}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <MockSimulatorDialog />
          {page.can.create ? (
            <>
              <Button size="sm" onClick={() => setNewDialogOpen(true)} className="gap-1 h-8 text-xs">
                <Plus className="size-3.5" aria-hidden />
                New chat
              </Button>
              <NewConversationDialog
                open={newDialogOpen}
                onOpenChange={setNewDialogOpen}
                contacts={contacts}
                assignees={assignees}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* Search Input */}
      <div className="p-3 border-b">
        <form onSubmit={handleSearchSubmit} className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by customer or phone..."
            className="pl-8 pr-8 h-9 text-xs"
          />
          {searchTerm ? (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </form>
      </div>

      {/* Status Tabs Filter */}
      <div className="flex items-center gap-1 p-2 border-b overflow-x-auto no-scrollbar">
        {STATUS_TABS.map((tab) => {
          const isActive = (currentStatus === 'ALL' && tab.id === 'ALL') || currentStatus === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => updateFilters({ status: tab.id === 'ALL' ? null : tab.id })}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-soft'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 ? (
                <span
                  className={`text-[10px] rounded-full px-1.5 py-0.2 ${
                    isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Conversation List / Feed */}
      <div className="flex-1 overflow-y-auto divide-y min-h-0">
        {page.conversations.length > 0 ? (
          page.conversations.map((conv: ConversationSummary) => (
            <ConversationListItem
              key={conv.id}
              conversation={conv}
              isSelected={conv.id === selectedId}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center h-full">
            {isFiltered ? (
              <>
                <UserX className="size-8 text-muted-foreground/60 mb-2" aria-hidden />
                <p className="text-sm font-medium text-foreground">No conversations found</p>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  No chats match the current search or status filter.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchTerm('');
                    updateFilters({ search: null, status: null, assignedTo: null });
                  }}
                  className="text-xs h-8"
                >
                  Clear filters
                </Button>
              </>
            ) : (
              <>
                <MessageSquare className="size-8 text-muted-foreground/60 mb-2" aria-hidden />
                <p className="text-sm font-medium text-foreground">No conversations yet</p>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  When customers send a WhatsApp message, threads will appear here.
                </p>
                {page.can.create ? (
                  <Button size="sm" onClick={() => setNewDialogOpen(true)} className="text-xs h-8">
                    Start a conversation
                  </Button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      {/* Cursor Pagination Bar */}
      {page.nextCursor ? (
        <div className="p-2 border-t bg-muted/20 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => updateFilters({ cursor: page.nextCursor })}
            className="text-xs h-7 w-full text-muted-foreground"
          >
            Load older conversations
          </Button>
        </div>
      ) : null}
    </div>
  );
}
