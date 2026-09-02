import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder blocks. Array indexes would trip the lint rule against them.
const STAT_KEYS = ['orders', 'spent', 'lastOrder', 'lastSpoke'] as const;
const CONTROL_KEYS = ['status', 'stage', 'owner'] as const;
const FIELD_KEYS = ['name', 'phone', 'email', 'city', 'source', 'tags'] as const;

/**
 * Shown while one customer's profile resolves.
 *
 * The list's skeleton would otherwise be inherited here — eight identical rows, which on the way
 * to a single profile reads as the wrong page having loaded.
 *
 * The shape is the profile's own: a back link, a round avatar beside the name, four figures in one
 * band, then the three cards. The band in particular is drawn the way `StatBand` draws it — cells
 * sharing a single card at the same breakpoints — because four separate bordered tiles collapsing
 * into one bordered card is a visible rearrangement, not a load.
 */
export default function ContactDetailLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading customer…</span>

      <div className="flex flex-col gap-4">
        {/* The back link, which is a small ghost button pulled left by its own padding. */}
        <Skeleton className="ml-0.5 h-7 w-32" />
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Skeleton className="h-8 w-52 max-w-full" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {STAT_KEYS.map((key) => (
            <div
              key={key}
              className="-ml-px -mt-px flex flex-col gap-1.5 border-l border-t border-border px-5 py-4"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <Skeleton className="h-5 w-44" />
          <div className="grid gap-4 sm:grid-cols-3">
            {CONTROL_KEYS.map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-control" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
          {FIELD_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-control" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
