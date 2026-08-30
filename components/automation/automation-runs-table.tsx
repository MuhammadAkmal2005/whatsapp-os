import { formatDistanceToNow, format } from 'date-fns';
import { CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

export type AutomationRunDTO = {
  id: string;
  subjectType: string;
  subjectId: string;
  status: 'PENDING' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  currentActionPosition: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

interface AutomationRunsTableProps {
  runs: AutomationRunDTO[];
}

export function AutomationRunsTable({ runs }: AutomationRunsTableProps) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        <p className="text-sm">No execution runs recorded yet.</p>
        <p className="text-xs mt-1">
          When this automation is triggered by inbound customer messages, status changes, or idle scans, run logs will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="border-b bg-muted/40 text-muted-foreground font-medium">
            <tr>
              <th className="h-10 px-4 align-middle w-[120px]">Status</th>
              <th className="h-10 px-4 align-middle">Subject</th>
              <th className="h-10 px-4 align-middle">Step</th>
              <th className="h-10 px-4 align-middle">Started</th>
              <th className="h-10 px-4 align-middle">Duration / Finished</th>
              <th className="h-10 px-4 align-middle">Result / Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.map((run) => (
              <tr key={run.id} className="transition-colors hover:bg-muted/50">
                <td className="p-4 align-middle">
                  <StatusBadge status={run.status} />
                </td>
                <td className="p-4 align-middle">
                  <div className="font-medium text-foreground">
                    {run.subjectType}
                  </div>
                  <div className="font-mono text-3xs text-muted-foreground truncate max-w-[150px]" title={run.subjectId}>
                    {run.subjectId}
                  </div>
                </td>
                <td className="p-4 align-middle">
                  <span className="font-medium">Action #{run.currentActionPosition + 1}</span>
                </td>
                <td className="p-4 align-middle">
                  <div className="text-foreground">
                    {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                  </div>
                  <div className="text-3xs text-muted-foreground">
                    {format(new Date(run.startedAt), 'MMM d, HH:mm:ss')}
                  </div>
                </td>
                <td className="p-4 align-middle">
                  {run.finishedAt ? (
                    <div>
                      <div className="text-foreground">
                        {calculateDuration(run.startedAt, run.finishedAt)}
                      </div>
                      <div className="text-3xs text-muted-foreground">
                        {format(new Date(run.finishedAt), 'HH:mm:ss')}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">In progress...</span>
                  )}
                </td>
                <td className="p-4 align-middle max-w-[280px]">
                  {run.error ? (
                    <div className="flex items-start gap-1.5 text-danger">
                      <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                      <span className="text-xs break-words">{run.error}</span>
                    </div>
                  ) : run.status === 'COMPLETED' ? (
                    <div className="flex items-center gap-1.5 text-success">
                      <CheckCircle2 className="size-3.5 shrink-0" />
                      <span>Successful</span>
                    </div>
                  ) : run.status === 'WAITING' ? (
                    <div className="flex items-center gap-1.5 text-warning">
                      <Clock className="size-3.5 shrink-0" />
                      <span>Awaiting timer resume</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Queued</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function calculateDuration(start: string, finish: string): string {
  const startMs = new Date(start).getTime();
  const finishMs = new Date(finish).getTime();
  const diffMs = finishMs - startMs;

  if (diffMs < 1000) {
    return `${diffMs}ms`;
  }
  return `${(diffMs / 1000).toFixed(1)}s`;
}

function StatusBadge({ status }: { status: AutomationRunDTO['status'] }) {
  switch (status) {
    case 'COMPLETED':
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="size-3" />
          Completed
        </Badge>
      );
    case 'RUNNING':
      return (
        <Badge variant="default" className="gap-1">
          <Clock className="size-3" />
          Running
        </Badge>
      );
    case 'WAITING':
      return (
        <Badge variant="warning" className="gap-1">
          <Clock className="size-3" />
          Waiting
        </Badge>
      );
    case 'FAILED':
      return (
        <Badge variant="danger" className="gap-1">
          <XCircle className="size-3" />
          Failed
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge variant="muted" className="gap-1">
          <XCircle className="size-3" />
          Cancelled
        </Badge>
      );
    case 'PENDING':
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="size-3" />
          Pending
        </Badge>
      );
  }
}
