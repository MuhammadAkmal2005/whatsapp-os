'use client';

/**
 * The message history for one conversation.
 *
 * Three things this has to get right that a plain list does not. It groups consecutive
 * messages from the same sender, so a run of AI replies reads as one voice rather than as
 * five labelled cards. It separates days with a divider that is a real list item, not a
 * decorative pill floating between siblings. And it jumps to the newest message on open
 * and on arrival — instantly the first time, because a smooth scroll through a hundred
 * bubbles is a visible animation nobody asked for, and not at all for a reader who has
 * asked the system to reduce motion.
 */

import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';

import { MessageBubble } from './message-bubble';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDayDivider } from '@/lib/datetime';
import type { MessageView } from '@/server/services/conversation/message.service';

/** Consecutive messages from one sender group; a change of sender or of day breaks the run. */
function senderKey(message: MessageView): string {
  if (message.direction === 'INBOUND') return `in:${message.senderContact?.id ?? 'contact'}`;
  if (message.sentByAi) return 'out:ai';
  return `out:${message.senderMember?.id ?? 'team'}`;
}

function messageAt(message: MessageView): Date {
  return new Date(message.occurredAt ?? message.createdAt);
}

export function MessageThread({
  messages,
  contactName,
  now,
}: {
  messages: MessageView[];
  contactName?: string | null;
  /** Resolved once on the server so "Today" is not recomputed against the browser clock. */
  now: Date;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // The repository returns newest-first for cursor pagination; a thread reads oldest-first.
  const chronological = [...messages].reverse();

  useEffect(() => {
    const target = bottomRef.current;
    if (!target) return;

    // Opening a conversation should land at the bottom with no visible travel. Only a
    // message arriving into a thread already on screen is worth animating, and only for a
    // reader who has not asked for less motion.
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const smooth = hasScrolledRef.current && !prefersReducedMotion;
    hasScrolledRef.current = true;

    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
  }, [messages.length]);

  if (chronological.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto bg-surface-sunken p-4">
        <EmptyState
          icon={MessageSquare}
          title="No messages yet"
          description={
            contactName
              ? `Send the first message to ${contactName} using the box below.`
              : 'Send the first message using the box below.'
          }
          variant="plain"
          size="compact"
        />
      </div>
    );
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto bg-surface-sunken px-3 py-4 scrollbar-thin sm:px-4"
      // A live region would re-announce the whole thread on every arrival. `relevant`
      // limits it to what was added, and `polite` waits for a pause in typing.
      aria-live="polite"
      aria-relevant="additions"
    >
      <ol className="mx-auto flex max-w-4xl flex-col gap-1">
        {chronological.map((message, index) => {
          const previous = index > 0 ? chronological[index - 1] : undefined;

          const at = messageAt(message);
          const newDay = !previous || messageAt(previous).toDateString() !== at.toDateString();
          const newSender = !previous || senderKey(previous) !== senderKey(message);

          return (
            <li key={message.id} className={newDay || newSender ? 'mt-2 first:mt-0' : undefined}>
              {newDay ? (
                <div className="my-3 flex items-center gap-3" role="separator">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {formatDayDivider(at, now)}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}

              <MessageBubble message={message} showSender={newDay || newSender} />
            </li>
          );
        })}
      </ol>
      <div ref={bottomRef} />
    </div>
  );
}
