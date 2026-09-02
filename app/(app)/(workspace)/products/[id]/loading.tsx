import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder blocks. Array indexes would trip the lint rule against them.
const STAT_KEYS = ['price', 'stock', 'sizes'] as const;
const FIELD_KEYS = ['name', 'code', 'price', 'category', 'description'] as const;

/**
 * Shown while one product resolves.
 *
 * The list's skeleton would otherwise be inherited here — eight identical rows, which on the
 * way to a single product reads as the wrong page having loaded.
 *
 * The geometry is the product page's, not an approximation of it: the same `max-w-3xl` column,
 * a back link above the title, three figures in a band, then the two form cards. The column
 * width matters most — without it the placeholder spans the full content area on a wide screen
 * and the page snaps to two-thirds of it a moment later, which is the one kind of loading state
 * that is worse than none.
 */
export default function ProductDetailLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading product…</span>

      <div className="flex flex-col gap-4">
        {/* The back link, which is a small ghost button pulled left by its own padding. */}
        <Skeleton className="ml-0.5 h-7 w-28" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-44 max-w-full" />
        </div>
      </div>

      {/* One card, three cells sharing it — the band the page draws, at its own breakpoints. */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {STAT_KEYS.map((key) => (
            <div
              key={key}
              className="-ml-px -mt-px flex flex-col gap-1.5 border-l border-t border-border px-5 py-4"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
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
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
