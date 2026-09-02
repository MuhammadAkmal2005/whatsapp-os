'use client';

/**
 * One row in the conversation list.
 *
 * The densest repeated surface in the product — a shop owner scans a few hundred of these
 * a day — so it is built around what the eye needs in the half second before it commits to
 * a click: who, how long ago, what about, and whether anyone is on it. Everything else is
 * one click away in the thread header and does not earn its place here.
 *
 * Three deliberate reductions from the previous version. Unread is signalled once, by
 * weight on the name plus a count, rather than by a dot *and* a count. The status chip
 * appears only when the status is not Open, because in an inbox Open is the default and a
 * column of identical chips is texture rather than information. And the channel is named
 * only when it is not WhatsApp, so the label appears when it distinguishes something and
 * stays out of the way while WhatsApp is the only channel connected.
 *
 * Everything below the name sits inside the flex column beside the avatar rather than being
 * pushed across by a hand-measured left padding, which is how the old row's `pl-11` came to
 * disagree with its own avatar size.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Bot, UserRound } from 'lucide-react';

import { ChannelLabel, ConversationStatusBadge, PriorityBadge } from './conversation-badges';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTimeCompact } from '@/lib/datetime';
import { initials } from '@/lib/names';
import { cn } from '@/lib/utils';
import type { ConversationSummary } from '@/server/services/conversation/conversation.service';

export function ConversationListItem({
  conversation,
  isSelected,
  now,
}: {
  conversation: ConversationSummary;
  isSelected: boolean;
  /** Resolved once on the server so every row measures "3h" against the same instant. */
  now: Date;
}) {
  const searchParams = useSearchParams();

  // Switching conversation must keep the search and filters the reader set up, or the list
  // they were working through reshuffles under them.
  const params = new URLSearchParams(searchParams.toString());
  params.set('id', conversation.id);

  const name =
    conversation.contact.name ??
    conversation.contact.waProfileName ??
    conversation.contact.phoneE164;

  const hasUnread = conversation.unreadCount > 0;
  const lastActivityAt = new Date(conversation.lastMessageAt ?? conversation.createdAt);

  return (
    <Link
      href={`/conversations?${params.toString()}`}
      // `aria-current` rather than `aria-selected`: the latter is only valid on an element
      // with a role that supports selection, and a link is not one. This is the same
      // pattern the sidebar navigation uses for the active page.
      aria-current={isSelected ? 'page' : undefined}
      className={cn(
        'flex items-start gap-2.5 border-b border-border px-3 py-3 last:border-b-0',
        'transition-colors duration-instant ease-out',
        isSelected
          ? // The rail is an inset shadow, so it costs no layout and the row does not shift
            // sideways by two pixels as the selection moves down the list.
            'marker-rail bg-surface-selected'
          : 'hover:bg-surface-sunken',
      )}
    >
      <Avatar className="mt-0.5 size-8 shrink-0">
        <AvatarFallback className="text-2xs">{initials(name)}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm text-foreground',
              hasUnread ? 'font-semibold' : 'font-medium',
            )}
          >
            {name}
          </span>
          <time
            dateTime={lastActivityAt.toISOString()}
            className="shrink-0 text-2xs tabular-nums text-muted-foreground"
          >
            {formatRelativeTimeCompact(lastActivityAt, now)}
          </time>
        </div>

        <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          {/* Only when it adds something. See the note at the top of the file. */}
          {conversation.channel === 'WHATSAPP' ? null : (
            <>
              <ChannelLabel channel={conversation.channel} />
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate">{conversation.contact.phoneE164}</span>
        </div>

        {conversation.summary ? (
          /* This is the AI's running summary of the conversation, not the last message —
             there is no stored preview column. It is the more useful of the two anyway:
             what the conversation is about beats whatever the last word happened to be. */
          <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
            {conversation.summary}
          </p>
        ) : null}

        <div className="flex items-center gap-1.5">
          {conversation.status === 'OPEN' ? null : (
            <ConversationStatusBadge status={conversation.status} size="sm" />
          )}

          {conversation.priority === 'HIGH' || conversation.priority === 'URGENT' ? (
            <PriorityBadge priority={conversation.priority} size="sm" />
          ) : null}

          {/* Who is answering, as an icon rather than a chip: the thread header spells it
              out, and at this size a third chip on the row costs more than it tells. */}
          {conversation.aiEnabled ? (
            <span className="inline-flex items-center text-ai">
              <Bot className="size-3.5" aria-hidden />
              <span className="sr-only">Your AI is replying</span>
            </span>
          ) : (
            <span className="inline-flex items-center text-warning">
              <UserRound className="size-3.5" aria-hidden />
              <span className="sr-only">Your team is replying</span>
            </span>
          )}

          <span className="ml-auto flex min-w-0 items-center gap-2">
            {conversation.assignedTo ? (
              <span className="min-w-0 truncate text-2xs text-muted-foreground">
                {conversation.assignedTo.user.name}
              </span>
            ) : null}

            {hasUnread ? (
              <Badge size="sm" shape="pill" className="tabular-nums">
                {conversation.unreadCount}
                <span className="sr-only"> unread</span>
              </Badge>
            ) : null}
          </span>
        </div>
      </div>
    </Link>
  );
}
