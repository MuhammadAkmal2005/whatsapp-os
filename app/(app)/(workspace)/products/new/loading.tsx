import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const FIELD_KEYS = ['f1', 'f2', 'f3', 'f4', 'f5'] as const;

/**
 * Shown while the new-product page loads its categories and plan limit. It mirrors the
 * form's shape — a title, a stack of fields, a footer — closely enough that the layout
 * does not jump when the real form arrives.
 */
export default function NewProductLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading the new product form…</span>

      {/* Mirrors `PageHeader`: the back link, then a gap, then the title and its summary. */}
      <div className="flex flex-col gap-4">
        <Skeleton className="h-control-sm w-32" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full max-w-prose" />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5 pt-5">
          {FIELD_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-control w-full" />
            </div>
          ))}
          <div className="flex items-center justify-end gap-3">
            <Skeleton className="h-control w-20" />
            <Skeleton className="h-control w-32" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
