import { Badge } from '@/components/ui/badge';

import { SAMPLE_ORDER } from '../sample-data';

/**
 * The order the conversation produced.
 *
 * Laid out as the order book lays it out, totals included, because the point being made is
 * that a chat did not just get answered — it got written down somewhere a shop can pack from.
 * The total is derived, not typed; see `sample-data.ts`.
 */
export function OrderMock() {
  return (
    <div className="flex flex-col bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            Order {SAMPLE_ORDER.reference}
          </p>
          <p className="truncate text-2xs text-muted-foreground">
            Ayesha K. · {SAMPLE_ORDER.city} · created by your AI
          </p>
        </div>
        <Badge variant="warning" size="sm" dot className="ml-auto shrink-0">
          Awaiting confirmation
        </Badge>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        {/* A tile rather than a photograph: a stock image of a kurta would be a stand-in for
            the shop's own catalogue, and a labelled placeholder is the more honest signal. */}
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-3xs font-medium text-muted-foreground">
          XL
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{SAMPLE_ORDER.productName}</p>
          <p className="truncate text-3xs text-muted-foreground">
            KURTA-BLK · {SAMPLE_ORDER.unitPrice} × {SAMPLE_ORDER.quantity}
          </p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-foreground">
          {SAMPLE_ORDER.subtotal}
        </span>
      </div>

      <dl className="flex flex-col gap-1.5 border-t border-border px-4 py-3 text-xs">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums text-foreground">{SAMPLE_ORDER.subtotal}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Delivery · {SAMPLE_ORDER.city}</dt>
          <dd className="tabular-nums text-foreground">{SAMPLE_ORDER.delivery}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-1.5">
          <dt className="font-medium text-foreground">Total</dt>
          <dd className="text-sm font-semibold tabular-nums text-primary">{SAMPLE_ORDER.total}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 pt-1">
          <dt className="text-muted-foreground">Payment</dt>
          <dd className="text-foreground">{SAMPLE_ORDER.paymentMethod}</dd>
        </div>
      </dl>

      <p className="border-t border-border bg-surface-sunken px-4 py-2.5 text-3xs leading-relaxed text-muted-foreground">
        Totals are always recalculated on our server from your saved prices — never from
        whatever the AI worked out in the chat.
      </p>
    </div>
  );
}
