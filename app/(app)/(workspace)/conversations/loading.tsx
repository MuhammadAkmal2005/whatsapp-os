import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and
// array indexes would trip the lint rule against them.
const ROW_KEYS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'] as const;

/**
 * Shown while the inbox resolves.
 *
 * Without this the route would fall back to the workspace skeleton, which mirrors the
 * dashboard — so opening the inbox would flash a four-up KPI grid on the way to a message
 * list. The frame here is the same one `InboxShell` draws, down to the viewport-height
 * calculation and the negative margin below `sm`, so the panes do not resize when the real
 * inbox replaces this.
 *
 * Only the list pane is drawn. The thread pane's content depends on whether a conversation
 * id is in the URL, and placing bubbles there would be a guess — so it keeps its ground and
 * nothing more, which is true of both the empty state and a loaded thread.
 */
export default function ConversationsLoading() {
  return (
    <div
      className={cn(
        'flex overflow-hidden border-y border-border bg-card',
        '-mx-4 sm:mx-0 sm:rounded-lg sm:border',
        'h-[calc(100dvh-var(--shell-inset,6rem))]',
      )}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading your inbox…</span>

      <div className="flex h-full w-full min-h-0 shrink-0 flex-col border-border bg-card md:w-80 md:border-r lg:w-96">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-control-sm w-24" />
        </div>

        <div className="shrink-0 border-b border-border px-3 py-2.5">
          <Skeleton className="h-control w-full" />
        </div>

        <div className="shrink-0 border-b border-border px-3 py-2">
          <Skeleton className="h-7 w-full" />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {ROW_KEYS.map((key) => (
            <div key={key} className="flex items-start gap-2.5 border-b border-border px-3 py-3">
              <Skeleton className="mt-0.5 size-8 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-baseline gap-2">
                  <Skeleton className="h-3.5 w-32 max-w-full" />
                  <Skeleton className="ml-auto h-2.5 w-8 shrink-0" />
                </div>
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-2.5 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="hidden h-full min-w-0 flex-1 bg-surface-sunken md:block" />
    </div>
  );
}
