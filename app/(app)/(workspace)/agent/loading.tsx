import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for the placeholder rows. A static skeleton has no data to key on, and array
// indexes would trip the lint rule against them.
const STAT_KEYS = ['s1', 's2', 's3'] as const;
const CARD_KEYS = ['identity', 'replies', 'handover'] as const;
const FIELD_KEYS = ['f1', 'f2'] as const;

/**
 * Shown while the assistant's configuration resolves.
 *
 * Repeats the real geometry — the three-cell counter band, then stacked cards each with a title,
 * a line of help text and two fields — so the name field lands where its placeholder was rather
 * than after a jump. `h-control` is the shared input height, which is what keeps the first field
 * from shifting when the real one arrives.
 */
export default function AgentLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading your AI assistant…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {STAT_KEYS.map((key) => (
            <div
              key={key}
              className="-ml-px -mt-px flex flex-col gap-2 border-l border-t border-border bg-card px-5 py-4"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </Card>

      {CARD_KEYS.map((key) => (
        <Card key={key}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full max-w-md" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {FIELD_KEYS.map((fieldKey) => (
              <div key={fieldKey} className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-control w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end border-t border-border pt-5">
        <Skeleton className="h-control w-32" />
      </div>
    </div>
  );
}
