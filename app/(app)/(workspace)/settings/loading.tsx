import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and
// array indexes would trip the lint rule against them.
const FIELD_KEYS = ['f1', 'f2'] as const;
const ROW_KEYS = ['r1', 'r2', 'r3'] as const;

/**
 * Shown while any settings section resolves.
 *
 * One file covers billing, team and WhatsApp: this renders as the children of
 * `settings/layout.tsx`, which has already painted the page heading and the section rail, so
 * the skeleton fills the content column and nothing else. Repeating the heading here would
 * double it for the moment the boundary is open.
 *
 * Every section opens the same way — a stack of cards, each with a title, a line of
 * explanation, and either fields or a list of people underneath — so the two cards below are
 * the shape of all three rather than a guess at any one of them.
 */
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading settings…</span>

      <Card>
        <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
          <Skeleton className="h-5 w-56 max-w-full" />
          <Skeleton className="h-4 w-full max-w-prose" />
        </div>
        <div className="flex flex-col gap-4 px-5 pb-5">
          {FIELD_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-control w-full max-w-form" />
            </div>
          ))}
          <Skeleton className="h-control w-36" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full max-w-prose" />
        </div>
        {ROW_KEYS.map((key) => (
          <div key={key} className="flex items-center gap-3 border-t border-border px-5 py-3.5">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-36 max-w-full" />
              <Skeleton className="h-3 w-52 max-w-full" />
            </div>
            <Skeleton className="ms-auto h-5 w-16 shrink-0" />
          </div>
        ))}
      </Card>
    </div>
  );
}
