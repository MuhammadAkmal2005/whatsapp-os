import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and array
// indexes would trip the lint rule against them.
const FIGURE_KEYS = ['orders', 'conversations', 'customers', 'leads'] as const;
const ACTIVITY_KEYS = ['a1', 'a2', 'a3', 'a4', 'a5'] as const;

/**
 * The dashboard's shape, drawn while its figures are queried.
 *
 * Two files need it. `dashboard/loading.tsx` is the boundary that makes a click on Dashboard
 * paint something immediately — without a loading module in that segment's own subtree, Next
 * sends router state alone on the prefetch, renders the segment with no Suspense wrapper, and
 * the previous page stays frozen on screen for the whole round trip. `(workspace)/loading.tsx`
 * is the fallback for the group as a whole, and the dashboard is the route you land on, so it
 * draws the same thing. One component so the two cannot drift.
 *
 * The geometry is the dashboard's: the page header, then one card holding a lead figure that
 * spans the band with four supporting figures beneath it, then the activity feed. An earlier
 * version drew four separate bordered KPI cards each with an icon tile, which is what the
 * dashboard looked like before `StatBand` — so the whole band visibly rearranged itself when the
 * numbers arrived instead of simply filling in.
 *
 * Two regions are deliberately absent. The worklist above the figures and the setup checklist
 * beside the feed each render only in some workspaces, and a placeholder for a panel that turns
 * out not to exist guarantees a jump for everyone who does not have it. Leaving them out costs
 * only a downward reflow, which does not move anything the reader has already started reading.
 */
export function DashboardSkeleton({ label = 'Loading your dashboard…' }: { label?: string }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>

      {/* Mirrors `PageHeader`: the title, then its one-line summary. */}
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      {/* One card, five cells sharing it. Each cell draws its own leading hairlines pulled a
          pixel outside itself, so the band's outer rules are clipped by the card. */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div className="-ml-px -mt-px flex flex-col gap-1.5 border-l border-t border-border px-5 py-5 sm:col-span-2 lg:col-span-4">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-44 max-w-full" />
            <Skeleton className="h-3 w-40 max-w-full" />
          </div>
          {FIGURE_KEYS.map((key) => (
            <div
              key={key}
              className="-ml-px -mt-px flex flex-col gap-1.5 border-l border-t border-border px-5 py-4"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-full max-w-36" />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col divide-y divide-border">
            {ACTIVITY_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                {/* The feed's icons sit bare rather than in a filled disc, so this is a glyph-
                    sized square and not a `size-8` avatar. */}
                <Skeleton className="size-4 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-3 w-12 shrink-0" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
