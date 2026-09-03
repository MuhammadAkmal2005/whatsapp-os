import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A single message in a mocked thread.
 *
 * One corner is squared on the side the message is anchored to — the same detail the real
 * inbox uses — because it is what makes a stack of bubbles read as a conversation without
 * an avatar beside every line.
 */
interface MockBubbleProps {
  side: 'in' | 'out';
  children: ReactNode;
  /** Timestamp, and for outbound messages the delivery state. */
  meta: string;
  /** Small label above the bubble, for the first message from a sender. */
  author?: string;
}

export function MockBubble({ side, children, meta, author }: MockBubbleProps) {
  const outbound = side === 'out';

  return (
    <div className={cn('flex flex-col gap-1', outbound ? 'items-end' : 'items-start')}>
      {author ? (
        <span className="px-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
          {author}
        </span>
      ) : null}
      <div
        className={cn(
          'max-w-[86%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
          outbound
            ? 'rounded-br-xs bg-primary text-primary-foreground'
            : 'rounded-bl-xs bg-secondary text-secondary-foreground',
        )}
      >
        {children}
      </div>
      <span className="px-1 text-3xs text-muted-foreground">{meta}</span>
    </div>
  );
}
