'use client';

/**
 * Scrollable message thread component.
 *
 * Renders the conversation's message history chronologically, handles automatic
 * scrolling to the latest message, and inserts date dividers.
 */

import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';

import { formatThreadDividerDate } from './conversation-badges';
import { MessageBubble } from './message-bubble';
import type { MessageView } from '@/server/services/conversation/message.service';

export function MessageThread({
  messages,
  contactName,
}: {
  messages: MessageView[];
  contactName?: string | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Messages arrive ordered DESC from the repository, so reverse them for chronological rendering
  const chronological = [...messages].reverse();

  // Scroll to bottom on message updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 bg-dot-grid bg-muted/10"
    >
      {chronological.length > 0 ? (
        <>
          {chronological.map((msg, index) => {
            const currentDate = new Date(msg.occurredAt ?? msg.createdAt).toDateString();
            const prevDate =
              index > 0
                ? new Date(
                    chronological[index - 1]?.occurredAt ?? chronological[index - 1]?.createdAt ?? 0,
                  ).toDateString()
                : null;
            const showDateDivider = currentDate !== prevDate;

            return (
              <div key={msg.id} className="space-y-3">
                {showDateDivider ? (
                  <div className="flex items-center justify-center my-3">
                    <span className="bg-muted/80 text-muted-foreground border px-2.5 py-0.5 rounded-full text-[11px] font-medium shadow-2xs">
                      {formatThreadDividerDate(msg.occurredAt ?? msg.createdAt)}
                    </span>
                  </div>
                ) : null}
                <MessageBubble message={msg} />
              </div>
            );
          })}
          <div ref={bottomRef} />
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <div className="p-3 bg-muted rounded-full mb-3">
            <MessageSquare className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <p className="text-sm font-semibold text-foreground">Start of conversation</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Send a message below to begin chatting with{' '}
            <span className="font-medium text-foreground">{contactName ?? 'this customer'}</span>.
          </p>
        </div>
      )}
    </div>
  );
}
