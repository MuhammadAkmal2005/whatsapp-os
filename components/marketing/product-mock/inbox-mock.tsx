import { Badge } from '@/components/ui/badge';

import { SAMPLE_ORDER } from '../sample-data';
import { MockBubble } from './mock-bubble';

/**
 * The hero's centrepiece: a shop's WhatsApp inbox mid-conversation.
 *
 * The numbers in it are the same ones the product would compute — 3,499 × 2 = 6,998, plus
 * 250 delivery, total 7,248 — because a mockup with arithmetic that does not add up is the
 * fastest way to lose a reader who sells things for a living.
 *
 * Below `sm` the conversation list is dropped rather than squeezed, which is also how the
 * real inbox behaves on a phone: one pane at a time.
 */

const THREADS = [
  { name: 'Ayesha K.', preview: '2 chahiye. Karachi delivery kitne din?', when: '2m', state: 'ai' },
  { name: 'Bilal R.', preview: 'Refund chahiye, order #1038', when: '9m', state: 'human' },
  { name: 'Usman T.', preview: 'Navy medium ka stock hai?', when: '24m', state: 'ai' },
  { name: 'Hina S.', preview: 'Shukriya bhai!', when: '1h', state: 'done' },
] as const;

const STATE_DOT: Record<(typeof THREADS)[number]['state'], string> = {
  ai: 'bg-primary',
  human: 'bg-warning',
  done: 'bg-border-strong',
};

export function InboxMock() {
  return (
    <div className="grid bg-card sm:grid-cols-[9.75rem_minmax(0,1fr)]">
      {/* ── Conversation list ── */}
      <div className="hidden flex-col border-r border-border bg-surface-sunken sm:flex">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Inbox
          </span>
          <span className="text-3xs tabular-nums text-muted-foreground">12 open</span>
        </div>
        <div className="flex flex-col">
          {THREADS.map((thread, index) => (
            <div
              key={thread.name}
              className={
                index === 0
                  ? 'marker-rail bg-surface-selected px-3 py-2'
                  : 'border-t border-border px-3 py-2'
              }
            >
              <div className="flex items-center gap-1.5">
                <span className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[thread.state]}`} />
                {/* `min-w-0` is what lets the truncation actually happen: a flex child's
                    default `min-width: auto` would widen the 9.75rem track instead. */}
                <span className="min-w-0 truncate text-2xs font-medium text-foreground">
                  {thread.name}
                </span>
                <span className="ml-auto shrink-0 text-3xs text-muted-foreground">
                  {thread.when}
                </span>
              </div>
              <p className="mt-0.5 truncate text-3xs text-muted-foreground">{thread.preview}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Thread ── */}
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-surface text-2xs font-semibold text-primary">
            AK
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">Ayesha K.</p>
            <p className="truncate text-3xs text-muted-foreground">Karachi · Returning customer</p>
          </div>
          <Badge variant="ai" size="sm" className="ml-auto shrink-0">
            {/* The ring reads as ongoing activity where a blinking dot would read as an
                alert the reader is expected to clear. */}
            <span className="relative flex size-1.5 shrink-0 items-center justify-center">
              <span className="absolute inline-flex size-1.5 rounded-full bg-current animate-mk-ring" />
              <span className="relative inline-flex size-1.5 rounded-full bg-current" />
            </span>
            AI replying
          </Badge>
        </div>

        <div className="flex flex-col gap-2.5 px-3 py-3">
          <MockBubble side="in" meta="7:42 pm">
            bhai black kurta XL available hai?
          </MockBubble>
          <MockBubble side="out" author="AI assistant" meta="7:42 pm · Read">
            Jee bilkul! Black kurta XL available hai — {SAMPLE_ORDER.unitPrice}. COD bhi available
            hai.
          </MockBubble>
          <MockBubble side="in" meta="7:43 pm">
            2 chahiye. Karachi delivery kitne din?
          </MockBubble>
          <MockBubble side="out" meta="7:43 pm · Delivered">
            {SAMPLE_ORDER.city} mein 2–3 working days. Do kurta ka total {SAMPLE_ORDER.total} hai (
            {SAMPLE_ORDER.delivery} delivery). Address bhej dein?
          </MockBubble>
        </div>

        <div className="mt-auto flex items-center gap-2 border-t border-border px-3 py-2">
          <span className="min-w-0 flex-1 truncate rounded-md border border-input bg-background px-2 py-1.5 text-3xs text-muted-foreground">
            Your AI is handling this conversation
          </span>
          <span className="shrink-0 rounded-md border border-border-strong px-2 py-1.5 text-3xs font-medium text-foreground">
            Take over
          </span>
        </div>
      </div>
    </div>
  );
}
