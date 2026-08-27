import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder blocks, matching the four-up summary and the two
// stacked cards below it. Array indexes would trip the lint rule against them.
const STAT_KEYS = ['price', 'stock', 'sizes', 'status'] as const;
const FIELD_KEYS = ['f1', 'f2', 'f3', 'f4', 'f5'] as const;

/**
 * Shown while one product resolves.
 *
 * The list's skeleton would otherwise be inherited here — eight identical rows, which on
 * the way to a single product reads as the wrong page having loaded. This mirrors the
 * product page instead: an image tile and a name, four figures, then the cards.
 */
export default function ProductDetailLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading product…</span>

      <Skeleton className="h-8 w-28" />

      <div className="flex items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-md" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56 max-w-full" />
          <Skeleton className="h-4 w-40 max-w-full" />
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
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          {FIELD_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
