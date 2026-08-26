import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows — a static skeleton has no data to key
// on, and array indexes would trip the lint rule against them.
const KPI_KEYS = ['revenue', 'orders', 'conversations', 'customers'] as const;
const ACTIVITY_KEYS = ['a1', 'a2', 'a3', 'a4', 'a5'] as const;
const CHECKLIST_KEYS = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;

/**
 * Fallback for the workspace content area while a page's server data resolves.
 * It renders inside the app shell — the sidebar is already painted — and mirrors
 * the dashboard's shape: a header, a four-up KPI row, and the activity/checklist
 * split. Matching the real layout keeps it from shifting under the reader when
 * the content arrives.
 */
export default function WorkspaceLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPI_KEYS.map((key) => (
          <Card key={key} className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="flex flex-col gap-4 p-6 lg:col-span-2">
          <Skeleton className="h-5 w-36" />
          {ACTIVITY_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-3 w-12 shrink-0" />
            </div>
          ))}
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          {CHECKLIST_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-3">
              <Skeleton className="size-5 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
