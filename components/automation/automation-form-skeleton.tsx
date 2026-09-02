import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and
// array indexes would trip the lint rule against them.
const CARD_KEYS = ['name', 'trigger', 'actions'] as const;
const FIELD_KEYS = ['f1', 'f2'] as const;

/**
 * The shape of the automation builder while it loads.
 *
 * Shared by the new and edit routes because both render the same `AutomationForm` under the
 * same header — three stacked cards (what it is called, what starts it, what it does) and a
 * save row. Without a skeleton at those segments they would inherit the automations list
 * skeleton and flash a table and a figure band on the way to a form.
 *
 * `title` is the one thing the two routes do not share, so each passes its own.
 */
export function AutomationFormSkeleton({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">{title}</span>

      {/* Mirrors `PageHeader` with its breadcrumb: back link, then title and summary. */}
      <div className="flex flex-col gap-4">
        <Skeleton className="h-control-sm w-36" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-4 w-full max-w-prose" />
        </div>
      </div>

      {CARD_KEYS.map((key) => (
        <Card key={key}>
          <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
            <Skeleton className="h-5 w-44 max-w-full" />
            <Skeleton className="h-4 w-full max-w-prose" />
          </div>
          <div className="flex flex-col gap-5 px-5 pb-5">
            {FIELD_KEYS.map((fieldKey) => (
              <div key={fieldKey} className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-control w-full max-w-form" />
              </div>
            ))}
          </div>
        </Card>
      ))}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-control w-40" />
      </div>
    </div>
  );
}
