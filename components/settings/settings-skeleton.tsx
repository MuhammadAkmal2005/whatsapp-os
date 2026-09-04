import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and array
// indexes would trip the lint rule against them.
const FIELD_KEYS = ['f1', 'f2', 'f3', 'f4', 'f5'] as const;
const ROW_KEYS = ['r1', 'r2', 'r3', 'r4'] as const;

/**
 * The settings area's loading shapes, shared by its section boundaries.
 *
 * `settings/layout.tsx` has already painted the page heading and the section rail by the time any
 * of these render, so they fill the content column and nothing else; repeating the heading would
 * double it for as long as the boundary is open.
 *
 * They live here rather than inside one `loading.tsx` because every section needs a boundary of
 * its own. Next decides a prefetch's payload from the loading modules in the *changing* segment's
 * subtree: arriving from outside settings the changing segment is `settings`, whose own boundary
 * covers it, but switching from Team to Billing changes only the leaf — and a leaf with no loading
 * module gets router state alone, which leaves the section you came from on screen until the new
 * one is ready. Four boundaries, one set of shapes, so they cannot drift apart.
 */

/** The stack every section renders, and the single announcement for it. */
export function SettingsSkeletonGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A card of labelled fields over a submit — the invite form, the connect form. */
export function SettingsFormCardSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <Card>
      <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
        <Skeleton className="h-5 w-56 max-w-full" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <div className="flex flex-col gap-4 px-5 pb-5">
        {FIELD_KEYS.slice(0, fields).map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-control w-full max-w-form" />
          </div>
        ))}
        <Skeleton className="h-control w-36" />
      </div>
    </Card>
  );
}

/** A card whose body is a list of people: an avatar, a name over an address, and a role chip. */
export function SettingsPeopleCardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      {ROW_KEYS.slice(0, rows).map((key) => (
        <div key={key} className="flex items-center gap-3 border-t border-border px-5 py-3.5">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-52 max-w-full" />
          </div>
          <Skeleton className="ms-auto h-5 w-16 shrink-0" />
        </div>
      ))}
    </Card>
  );
}

/**
 * The plan the workspace is on. A `CardToolbar` carries the plan name and its status chip on the
 * leading edge with the price on the trailing one, then the billing period sits under a rule.
 */
export function SettingsPlanCardSkeleton() {
  return (
    <Card>
      <div className="flex flex-col gap-3 px-5 pb-4 pt-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-4 w-full max-w-prose" />
        </div>
        <Skeleton className="h-7 w-28 shrink-0" />
      </div>
      <div className="px-5 pb-5">
        <div className="border-t border-border pt-4">
          <Skeleton className="h-3.5 w-56 max-w-full" />
        </div>
      </div>
    </Card>
  );
}

/**
 * Usage against the plan, drawn as `PlanLimitList` draws it: a sunken group heading, then rows
 * of a label and a count over a meter. One group rather than both, because the second is below
 * the fold on every viewport this screen is read on.
 */
export function SettingsUsageCardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-1 px-5 pb-4 pt-5">
        <Skeleton className="h-5 w-44 max-w-full" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <div className="border-t border-border">
        <div className="bg-surface-sunken px-5 py-2">
          <Skeleton className="h-3 w-24" />
        </div>
        {ROW_KEYS.slice(0, rows).map((key) => (
          <div
            key={key}
            className="flex flex-col gap-2 border-t border-border px-5 py-3.5 first:border-t-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              <Skeleton className="h-4 w-32 max-w-full" />
              <Skeleton className="h-3 w-20 shrink-0" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

