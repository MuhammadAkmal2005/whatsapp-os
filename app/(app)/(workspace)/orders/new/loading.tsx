import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and
// array indexes would trip the lint rule against them.
const LEFT_FIELD_KEYS = ['l1', 'l2'] as const;
const RIGHT_FIELD_KEYS = ['r1', 'r2', 'r3'] as const;

/**
 * Shown while the new-order page loads the product catalogue and the customer list.
 *
 * Both are bounded server reads, so this is usually brief — but without it the route falls
 * back to the workspace skeleton and a KPI grid flashes on the way to a form. The two-column
 * split below `lg` is the same one `CreateOrderForm` uses (items on the left across two of
 * three columns, customer and delivery on the right), so the Items card does not jump
 * sideways when the real form arrives.
 */
export default function NewOrderLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading the order form…</span>

      {/* Mirrors `PageHeader` with its breadcrumb: the back link, then the title and summary. */}
      <div className="flex flex-col gap-4">
        <Skeleton className="h-control-sm w-28" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full max-w-prose" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
              <Skeleton className="h-5 w-20" />
            </div>
            <div className="flex flex-col gap-4 px-5 pb-5">
              {LEFT_FIELD_KEYS.map((key) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-control w-full" />
                </div>
              ))}
              <Skeleton className="h-control w-40" />
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="flex flex-col gap-4 px-5 pb-5">
              {RIGHT_FIELD_KEYS.map((key) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-control w-full" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
