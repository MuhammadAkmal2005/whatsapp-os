import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and array
// indexes would trip the lint rule against them.
const ROW_KEYS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const;

/**
 * Shown while the list resolves. It replaces the workspace-level skeleton, which mirrors the
 * dashboard and would otherwise flash a four-up KPI grid on the way to a table.
 *
 * The row count is arbitrary; the row shape is not. It matches `KnowledgeTable` closely enough
 * that the title lands where the placeholder was and the status chip lands where its chip was,
 * so nothing jumps under the reader's eye when the rows arrive.
 */
export default function KnowledgeLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading your knowledge…</span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {ROW_KEYS.map((key) => (
            <div
              key={key}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-6"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="size-8 shrink-0 rounded-md" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
