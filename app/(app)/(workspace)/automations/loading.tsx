import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and
// array indexes would trip the lint rule against them.
const STAT_KEYS = ['s1', 's2', 's3'] as const;
const ROW_KEYS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] as const;

/**
 * Shown while the automation list resolves. Replaces the workspace skeleton, which mirrors
 * the dashboard and would flash a KPI grid on the way to a table.
 *
 * The three-cell band and the table repeat the real geometry — including the leading
 * hairlines each `Stat` cell draws and the header row's sunken ground — so the figures and
 * the first automation name land where their placeholders were.
 */
export default function AutomationsLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading automations…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {STAT_KEYS.map((key) => (
            <div
              key={key}
              className="-ml-px -mt-px flex flex-col gap-2 border-l border-t border-border bg-card px-5 py-4"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-control w-full sm:w-72" />
        <Skeleton className="h-control w-40" />
        <Skeleton className="h-control w-32" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b border-border bg-surface-sunken px-4 py-2.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="hidden h-3 w-20 md:block" />
          <Skeleton className="ml-auto hidden h-3 w-10 md:block" />
        </div>

        {ROW_KEYS.map((key) => (
          <div key={key} className="flex items-center gap-4 border-b border-border px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="hidden h-5 w-28 shrink-0 md:block" />
            <Skeleton className="hidden h-4 w-8 shrink-0 md:block" />
            <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
          </div>
        ))}
      </Card>
    </div>
  );
}
