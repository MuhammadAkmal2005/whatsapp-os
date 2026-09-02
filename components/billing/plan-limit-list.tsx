import { Badge } from '@/components/ui/badge';
import { Meter } from '@/components/ui/meter';
import type { LimitName } from '@/config/plans';
import {
  CAPACITY_LIMIT_NAMES,
  MONTHLY_LIMIT_NAMES,
  formatLimitValue,
  limitLabel,
} from '@/lib/labels';

/**
 * One allowance's standing, normalised.
 *
 * Both callers already hold this information in slightly different shapes — the analytics screen
 * as a `Record<LimitName, LimitCheck>`, the billing screen as a list of quota metrics — so each
 * maps into this rather than the list learning about either.
 */
export type PlanLimitRow = {
  name: LimitName;
  used: number;
  /** `null` means the plan does not meter this. */
  limit: number | null;
  /** The allowance is at or above the warning threshold, but still has room. */
  nearLimit: boolean;
  /** Nothing left. */
  exceeded: boolean;
};

interface PlanLimitListProps {
  rows: readonly PlanLimitRow[];
  /** Heading for the resetting group. Pass the month when the caller knows which one it is. */
  monthlyHeading?: string;
}

/**
 * The plan's ten allowances, grouped by whether they reset.
 *
 * The billing screen and the analytics screen both show these numbers, and each had invented its
 * own version: ten bordered boxes in a two-column grid, with a chip on every row — usually saying
 * "1,998 remaining", which the two numbers beside it already said — and a hand-rolled progress bar
 * whose fill colour came from a raw palette with no dark-mode counterpart.
 *
 * A quota list is read by scanning for the row that is nearly full, so the rows share a left edge
 * and hairline dividers, the bars line up down the column, and a chip appears only where something
 * needs attention. Monthly allowances are kept apart from fixed capacity because "4,800 of 5,000"
 * means something quite different when the counter empties on the first of the month.
 */
export function PlanLimitList({ rows, monthlyHeading = 'This month' }: PlanLimitListProps) {
  const byName = new Map(rows.map((row) => [row.name, row]));

  return (
    <>
      <LimitSection heading={monthlyHeading} names={MONTHLY_LIMIT_NAMES} byName={byName} />
      <LimitSection heading="In your workspace" names={CAPACITY_LIMIT_NAMES} byName={byName} />
    </>
  );
}

function LimitSection({
  heading,
  names,
  byName,
}: {
  heading: string;
  names: readonly LimitName[];
  byName: Map<LimitName, PlanLimitRow>;
}) {
  const present = names.flatMap((name) => {
    const row = byName.get(name);
    return row ? [row] : [];
  });

  if (present.length === 0) return null;

  return (
    <section className="border-t border-border">
      <h3 className="eyebrow bg-surface-sunken px-5 py-2">{heading}</h3>
      <ul>
        {present.map((row) => (
          <li key={row.name} className="border-t border-border first:border-t-0">
            <LimitRow row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LimitRow({ row }: { row: PlanLimitRow }) {
  const label = limitLabel(row.name);
  const isUnlimited = row.limit === null;

  return (
    <div className="flex flex-col gap-2 px-5 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{label}</span>

        <span className="flex shrink-0 items-baseline gap-2">
          <LimitStatusBadge row={row} />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            <span className="text-foreground">{formatLimitValue(row.name, row.used)}</span>
            {isUnlimited ? null : <> of {formatLimitValue(row.name, row.limit ?? 0)}</>}
          </span>
        </span>
      </div>

      <Meter value={row.used} max={row.limit} label={label} exceeded={row.exceeded} />
    </div>
  );
}

/**
 * A chip only when the reader has to do something about it. On a list of ten rows, a chip on
 * every row is a texture rather than a signal.
 */
function LimitStatusBadge({ row }: { row: PlanLimitRow }) {
  if (row.limit === null) {
    return (
      <Badge variant="muted" size="sm">
        Unlimited
      </Badge>
    );
  }

  if (row.exceeded) {
    return (
      <Badge variant="danger" size="sm">
        Full
      </Badge>
    );
  }

  if (row.nearLimit) {
    return (
      <Badge variant="warning" size="sm">
        Almost full
      </Badge>
    );
  }

  return null;
}
