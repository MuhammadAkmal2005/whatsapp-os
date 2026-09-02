import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys. Array indexes as React keys are a lint error in this project, and this file
// used them before — eight `key={i}` cells that would have failed the next lint run.
const STAT_KEYS = [
  'revenue',
  'averageOrder',
  'messages',
  'conversations',
  'firstReply',
  'aiHandled',
  'aiTokens',
  'newCustomers',
] as const;
const CHART_KEYS = ['revenue', 'messaging'] as const;

/**
 * Shown while the analytics range is queried.
 *
 * Analytics is the slowest screen in the product — eight aggregates and a day-by-day series over
 * the selected period — so this is the skeleton a reader sees most often, and it mirrors the page
 * closely: the header with its range control, the tab track, one band of eight figures, then two
 * charts side by side from `lg` up.
 *
 * The figures are drawn as `StatBand` draws them, cells sharing a single card. The previous
 * version used eight separate bordered cards in a four-up grid, which is neither what the page
 * renders nor the same height, so the whole screen jumped when the data arrived.
 */
export default function AnalyticsLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading analytics…</span>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-control w-40" />
          <Skeleton className="h-control w-28" />
          <Skeleton className="size-control" />
        </div>
      </div>

      {/* The tab track, at its real height. */}
      <Skeleton className="h-control w-72 max-w-full rounded-md" />

      <div className="mt-4 flex flex-col gap-6">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {STAT_KEYS.map((key) => (
              <div
                key={key}
                className="-ml-px -mt-px flex flex-col gap-1.5 border-l border-t border-border px-5 py-4"
              >
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-3 w-full max-w-40" />
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {CHART_KEYS.map((key) => (
            <Card key={key} className="flex flex-col">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-56 max-w-full" />
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <Skeleton className="h-56 w-full sm:h-64" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
