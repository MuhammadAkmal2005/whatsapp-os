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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          {FIELD_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <div className="flex items-center justify-end gap-3">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
