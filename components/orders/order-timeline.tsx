import { Bot } from 'lucide-react';

import { formatDateTime } from '@/lib/datetime';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/server/validation/order';
import type { OrderEventRow } from '@/server/repositories/order.repository';

/**
 * The order's history, oldest first.
 *
 * Every status change writes an event, so this is the audit trail a shop owner reads to
 * answer "what happened to this order, and when". The repository returns the events already
 * sorted, so this only has to render them.
 *
 * A server component: it is a static list of past facts, so none of it ships as JavaScript.
 */

/** A human sentence for one event, derived from its type and the status it moved to. */
function describe(event: OrderEventRow): string {
  if (event.type === 'ORDER_CREATED') return 'Order placed';
  if (event.type === 'ORDER_CANCELLED') return 'Order cancelled';
  if (event.toStatus) return `Marked as ${ORDER_STATUS_LABELS[event.toStatus as OrderStatus].toLowerCase()}`;
  return 'Updated';
}

export function OrderTimeline({ events }: { events: OrderEventRow[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No history yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-4">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-sm font-medium text-foreground">{describe(event)}</span>
              {event.byAi ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Bot className="size-3" aria-hidden />
                  by AI
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
            {event.note ? (
              <p className="mt-1 text-sm text-muted-foreground">{event.note}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
