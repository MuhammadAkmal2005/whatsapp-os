'use client';

/**
 * Individual conversation card in the inbox sidebar.
 *
 * Highlights the active conversation, displays customer information, unread badges,
 * assignment state, and snippet of latest activity.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { User } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  ChannelBadge,
  ConversationStatusBadge,
  formatRelativeTime,
  initials,
  PriorityBadge,
} from './conversation-badges';
import type { ConversationSummary } from '@/server/services/conversation/conversation.service';

export function ConversationListItem({
  conversation,
  isSelected,
}: {
  conversation: ConversationSummary;
  isSelected: boolean;
}) {
  const searchParams = useSearchParams();

  // Preserve existing filter params while switching selected conversation
  const createQueryString = (conversationId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('id', conversationId);
    return params.toString();
  };

  const displayName =
    conversation.contact.name ||
    conversation.contact.waProfileName ||
    conversation.contact.phoneE164;

  const hasPriority = conversation.priority === 'HIGH' || conversation.priority === 'URGENT';

  return (
    <Link
      href={`/conversations?${createQueryString(conversation.id)}`}
      className={`group relative flex flex-col gap-1.5 p-3.5 transition-all duration-150 border-b last:border-b-0 hover:bg-accent/50 ${
        isSelected
          ? 'bg-accent/80 border-l-4 border-l-primary pl-[10px]'
          : 'bg-card hover:bg-muted/40'
      }`}
      aria-selected={isSelected}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar className="size-9 shrink-0 border">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {displayName}
              </span>
              {conversation.unreadCount > 0 ? (
                <span className="inline-flex size-2 rounded-full bg-primary" aria-label="Unread" />
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ChannelBadge channel={conversation.channel} />
              {conversation.contact.phoneE164 && conversation.contact.name ? (
                <>
                  <span>•</span>
                  <span className="truncate">{conversation.contact.phoneE164}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {formatRelativeTime(conversation.lastMessageAt ?? conversation.createdAt)}
          </span>
          {conversation.unreadCount > 0 ? (
            <span className="inline-flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {conversation.unreadCount}
            </span>
          ) : null}
        </div>
      </div>

      {conversation.summary ? (
        <p className="line-clamp-2 text-xs text-muted-foreground/90 pl-11">
          {conversation.summary}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-1.5 pl-11 pt-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <ConversationStatusBadge status={conversation.status} className="text-[10px] py-0 px-1.5" />
          {hasPriority ? (
            <PriorityBadge priority={conversation.priority} className="text-[10px] py-0 px-1.5" />
          ) : null}
        </div>

        {conversation.assignedTo ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground truncate max-w-[120px]"
            title={`Assigned to ${conversation.assignedTo.user.name}`}
          >
            <User className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{conversation.assignedTo.user.name}</span>
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/70 italic">Unassigned</span>
        )}
      </div>
    </Link>
  );
}
