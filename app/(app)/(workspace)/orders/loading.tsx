import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and
// array indexes would trip the lint rule against them.
const ROW_KEYS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'] as const;

/**
 * Shown while the order book resolves. It replaces the workspace-level skeleton, which
 * mirrors the dashboard and would otherwise flash a KPI grid on the way to a list of
 * orders.
 *
 * The row count is arbitrary; the row shape is not. It matches `OrderList` closely enough
 * that the text lands where the placeholder was, so nothing jumps under the reader's eye
 * when the data arrives.
 */
export default function OrdersLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading orders…</span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full sm:w-72" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-36" />
      </div>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {ROW_KEYS.map((key) => (
            <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-6">
              <Skeleton className="size-10 shrink-0 rounded-md" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-52 max-w-full" />
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
