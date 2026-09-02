/**
 * One automation's run history.
 *
 * A run is a single execution: something happened, this rule started, and it either finished,
 * is still going, is waiting on a timer, or stopped. The table answers three questions in that
 * order — when, what it acted on, how it ended.
 *
 * Two things this deliberately does not do. It does not name the step a run stopped on, only
 * the step's number, because the rule's steps can be edited after a run and today's list of
 * steps is not the list that ran — a name would be a guess dressed as a fact. And it does not
 * render relative times ("3 minutes ago"): this is a Server Component, so a relative string is
 * computed once at render and then sits there getting older, which reads as a stuck page. The
 * absolute timestamp is always true.
 */

import { History } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardFooter } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/datetime';
import { humaniseCode, runStatusLabel } from '@/lib/labels';
import type { RunStatus } from '@/server/validation/automation';

export type AutomationRunDTO = {
  id: string;
  subjectType: string;
  subjectId: string;
  status: RunStatus;
  currentActionPosition: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

export interface AutomationRunsTableProps {
  runs: AutomationRunDTO[];
  /**
   * How many runs the page asked for. Passed in rather than assumed so the footer can say
   * "the last 30" and be right if that number ever changes.
   */
  limit: number;
}

/** Which status colour a run's outcome earns. */
const STATUS_VARIANT: Record<RunStatus, 'success' | 'info' | 'warning' | 'danger' | 'muted'> = {
  COMPLETED: 'success',
  RUNNING: 'info',
  WAITING: 'warning',
  FAILED: 'danger',
  CANCELLED: 'muted',
};

type Subject = { label: string; href: string | null };

/**
 * What the run acted on, in the words the rest of the product uses — the sidebar says
 * "Customers", so a run against a `Contact` says Customer here too.
 *
 * The record's id is not shown. It is a UUID, which tells a shop owner nothing, so the type
 * becomes a link to the record instead. An unrecognised subject type stays plain text rather
 * than becoming a link to a route that may not exist.
 */
function subjectOf(run: AutomationRunDTO): Subject {
  const id = encodeURIComponent(run.subjectId);

  switch (run.subjectType) {
    case 'Conversation':
      return { label: 'Conversation', href: `/conversations?id=${id}` };
    case 'Contact':
      return { label: 'Customer', href: `/contacts/${id}` };
    case 'Order':
      return { label: 'Order', href: `/orders/${id}` };
    default:
      return { label: humaniseCode(run.subjectType), href: null };
  }
}

/**
 * How far through the rule the run got.
 *
 * `currentActionPosition` means different things at different statuses: the step that failed,
 * the step a timer will resume on, the step currently running, or one past the end once every
 * step is done. Each status gets its own sentence rather than one misleading "Action #N".
 */
function stepSummary(run: AutomationRunDTO): string {
  const step = run.currentActionPosition + 1;

  switch (run.status) {
    case 'COMPLETED':
      return 'Every step ran';
    case 'RUNNING':
      return `Running step ${step}`;
    case 'WAITING':
      return `Waiting to run step ${step}`;
    case 'FAILED':
    case 'CANCELLED':
      return `Stopped at step ${step}`;
    default:
      return `At step ${step}`;
  }
}

/** How long the run took, from milliseconds up to days — a rule with a wait step can span both. */
function formatDuration(startedAt: string, finishedAt: string): string {
  const milliseconds = Math.max(new Date(finishedAt).getTime() - new Date(startedAt).getTime(), 0);
  if (milliseconds < 1000) return `${milliseconds}ms`;

  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min`;

  const hours = minutes / 60;
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hr`;

  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function AutomationRunsTable({ runs, limit }: AutomationRunsTableProps) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="This automation has not run yet"
        description="Each time it starts — a message arriving, an order changing, a chat going quiet — the run is listed here with what it acted on and how it ended."
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <TableContainer>
        <Table aria-label="Recent runs of this automation">
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead className="hidden md:table-cell">Ran on</TableHead>
              <TableHead numeric className="hidden md:table-cell">
                Took
              </TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {runs.map((run) => {
              const subject = subjectOf(run);
              const duration = run.finishedAt
                ? formatDuration(run.startedAt, run.finishedAt)
                : null;

              return (
                <TableRow key={run.id}>
                  <TableCell className="whitespace-nowrap align-top">
                    <div className="flex flex-col gap-1">
                      <span className="text-foreground">
                        {formatDateTime(new Date(run.startedAt))}
                      </span>

                      {/* Below md there is no column for the subject or the duration, so both
                          fold in here rather than disappearing. */}
                      <span className="text-sm text-muted-foreground md:hidden">
                        {subject.href ? (
                          <Link href={subject.href} className="hover:text-primary hover:underline">
                            {subject.label}
                          </Link>
                        ) : (
                          subject.label
                        )}
                        {duration ? ` · took ${duration}` : null}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="hidden align-top md:table-cell">
                    {subject.href ? (
                      <Link
                        href={subject.href}
                        className="text-foreground hover:text-primary hover:underline"
                      >
                        {subject.label}
                      </Link>
                    ) : (
                      subject.label
                    )}
                  </TableCell>

                  <TableCell numeric className="hidden align-top md:table-cell">
                    {duration ?? (
                      <>
                        <span aria-hidden className="text-muted-foreground">
                          —
                        </span>
                        <span className="sr-only">Not finished</span>
                      </>
                    )}
                  </TableCell>

                  <TableCell className="align-top">
                    <div className="flex flex-col items-start gap-1.5">
                      <Badge variant={STATUS_VARIANT[run.status]}>{runStatusLabel(run.status)}</Badge>

                      <span className="text-sm text-muted-foreground">{stepSummary(run)}</span>

                      {run.error ? (
                        <span className="max-w-prose break-words text-sm text-destructive">
                          {run.error}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {runs.length >= limit ? (
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            Showing the {limit} most recent runs. Older ones are not listed here.
          </p>
        </CardFooter>
      ) : null}
    </Card>
  );
}
