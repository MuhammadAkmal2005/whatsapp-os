'use client';

/**
 * What we actually know about a connection, and when we last checked.
 *
 * This panel exists because "Connected" on its own is not evidence. A token can be revoked
 * in Business Manager, a subscription can be removed, a number can be deregistered, and
 * none of those events notify us — so the badge above could stay green while nothing
 * arrives. Each row here is one thing that was verified, and the timestamp says how stale
 * that verification is.
 *
 * The "Check now" button re-asks Meta rather than re-reading our own row. It is the action
 * for the moment just after someone fixed something in Business Manager and wants to know
 * whether it took, which is why it forces past the five-minute cache.
 *
 * Nothing rendered here is a secret. The checks carry sentences written for a shop owner
 * and a stable name; no token, no PIN, no app secret is reachable from this component's
 * props, because the report type does not carry one.
 */

import { CheckCircle2, CircleSlash, MinusCircle, RefreshCw, XCircle } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  HEALTH_CHECK_LABELS,
  HEALTH_CHECK_STATE_LABELS,
  HEALTH_CHECK_TONES,
} from '@/components/settings/whatsapp/connection-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/datetime';
import { runConnectionHealthCheckAction } from '@/server/actions/meta-connection.actions';
import type {
  ConnectionHealthReport,
  HealthCheckState,
} from '@/server/services/whatsapp/meta-connection-health.service';

const STATE_ICONS: Record<HealthCheckState, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: MinusCircle,
  fail: XCircle,
  skipped: CircleSlash,
};

const ICON_COLOURS: Record<HealthCheckState, string> = {
  pass: 'text-success',
  warn: 'text-warning',
  fail: 'text-destructive',
  skipped: 'text-muted-foreground',
};

type ConnectionHealthPanelProps = {
  accountId: string;
  /** The cached report rendered on the server, replaced in place by a live check. */
  report: ConnectionHealthReport;
  canCheck: boolean;
};

export function ConnectionHealthPanel({
  accountId,
  report: initialReport,
  canCheck,
}: ConnectionHealthPanelProps) {
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function check() {
    setError(null);
    startTransition(async () => {
      const result = await runConnectionHealthCheckAction({ accountId });
      if (result.ok) {
        setReport(result.report);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="eyebrow">What we checked</h3>

        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {/* The distinction is the point: a cached report describes what our own row
                says, and only a live one describes what Meta says right now. */}
            {report.live
              ? `Checked with Meta ${formatRelativeTime(report.checkedAt)}`
              : `Last checked ${formatRelativeTime(report.checkedAt)}`}
          </p>
          {canCheck ? (
            <Button variant="outline" size="sm" onClick={check} isLoading={pending}>
              <RefreshCw aria-hidden />
              {pending ? 'Checking…' : 'Check now'}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" live="assertive">
          <XCircle aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="divide-y divide-border rounded-md border border-border">
        {report.checks.map((entry) => {
          const Icon = STATE_ICONS[entry.state];
          return (
            <li key={entry.name} className="flex items-start gap-3 px-4 py-3">
              <Icon className={`mt-0.5 size-4 shrink-0 ${ICON_COLOURS[entry.state]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    {HEALTH_CHECK_LABELS[entry.name]}
                  </span>
                  <Badge variant={HEALTH_CHECK_TONES[entry.state]} size="sm">
                    {HEALTH_CHECK_STATE_LABELS[entry.state]}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{entry.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
