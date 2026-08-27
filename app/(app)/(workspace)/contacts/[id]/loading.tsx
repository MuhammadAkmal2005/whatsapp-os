import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder blocks, matching the four-up summary and the two
// stacked cards below it. Array indexes would trip the lint rule against them.
const STAT_KEYS = ['orders', 'spent', 'lastOrder', 'lastSpoke'] as const;
const FIELD_KEYS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const;

/**
 * Shown while one customer's profile resolves.
 *
 * The list's skeleton would otherwise be inherited here — eight identical rows, which
 * on the way to a single profile reads as the wrong page having loaded. This mirrors
 * the profile instead: an avatar and name, four figures, then the cards.
 */
export default function ContactDetailLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading customer…</span>

      <Skeleton className="h-8 w-32" />

      <div className="flex items-center gap-4">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-52 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {STAT_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          {FIELD_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
