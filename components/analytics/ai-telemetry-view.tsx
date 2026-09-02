import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Stat, StatBand } from '@/components/ui/stat';
import { formatUsdMicros } from '@/lib/money';
import { handoffReasonLabel, humaniseCode, turnSourceLabel } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { AITelemetryBreakdown } from '@/server/repositories/analytics.repository';

interface AITelemetryViewProps {
  telemetry: AITelemetryBreakdown;
}

/**
 * What the AI did, and what it cost.
 *
 * The most technical screen in the product, and the one most at risk of being written for
 * the engineer who built it rather than the owner paying for it. So the machine codes are
 * translated, "µUSD computed" is gone, and the three breakdowns say what a zero *means*
 * rather than reporting the absence of rows.
 *
 * Model names and token counts stay in the monospace face, because they are machine values a
 * reader compares character by character. Prose does not.
 */
export function AITelemetryView({ telemetry }: AITelemetryViewProps) {
  const totalTokens = telemetry.totalInputTokens + telemetry.totalOutputTokens;

  return (
    <div className="flex flex-col gap-6">
      <StatBand columns={4} label="AI activity for the selected period">
        <Stat
          label="Replies generated"
          value={telemetry.totalRequests.toLocaleString()}
          hint="Across conversations, tests and automations"
        />
        <Stat
          label="Answered from your data"
          value={`${telemetry.groundingPassRate}%`}
          hint="The rest were held back rather than guessed"
        />
        <Stat
          label="Tokens used"
          value={totalTokens.toLocaleString()}
          hint={`${telemetry.totalInputTokens.toLocaleString()} read, ${telemetry.totalOutputTokens.toLocaleString()} written`}
        />
        <Stat
          label="Estimated cost"
          value={formatUsdMicros(telemetry.totalCostMicros)}
          hint="Our estimate from published model prices"
        />
      </StatBand>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Cost by model</CardTitle>
        </CardHeader>
        {telemetry.byModel.length === 0 ? (
          <CardContent>
            <EmptyState
              size="compact"
              title="Your AI hasn't replied yet in this period"
              description="Once it answers a customer or you try it in the playground, every reply is logged here with the model that produced it and what it cost."
            />
          </CardContent>
        ) : (
          <TableContainer>
            <Table aria-label="AI cost by model">
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead numeric>Replies</TableHead>
                  <TableHead numeric>Read</TableHead>
                  <TableHead numeric>Written</TableHead>
                  <TableHead numeric>Total</TableHead>
                  <TableHead numeric>Avg. time</TableHead>
                  <TableHead numeric>Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {telemetry.byModel.map((row) => (
                  <TableRow key={`${row.provider}:${row.model}`}>
                    <TableCell className="font-mono text-sm font-medium">{row.model}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {row.provider}
                    </TableCell>
                    <TableCell numeric>{row.requests.toLocaleString()}</TableCell>
                    <TableCell numeric>{row.inputTokens.toLocaleString()}</TableCell>
                    <TableCell numeric>{row.outputTokens.toLocaleString()}</TableCell>
                    <TableCell numeric>{row.totalTokens.toLocaleString()}</TableCell>
                    <TableCell numeric>{formatLatency(row.avgLatencyMs)}</TableCell>
                    <TableCell numeric className="font-medium text-foreground">
                      {formatUsdMicros(row.costMicros, { precise: true })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Breakdown
          title="Where the AI was used"
          counts={telemetry.bySource}
          format={turnSourceLabel}
          emptyMessage="Nothing yet in this period."
        />
        <Breakdown
          title="Why it passed a chat to a person"
          counts={telemetry.byHandoffReason}
          format={handoffReasonLabel}
          emptyMessage="Your AI handled every conversation on its own."
        />
        <Breakdown
          title="What it refused to guess at"
          counts={telemetry.byBlockedReason}
          format={humaniseCode}
          emptyMessage="Every reply was backed by your own business information."
          tone="destructive"
        />
      </div>
    </div>
  );
}

/**
 * A count-per-reason panel.
 *
 * The counts arrive as an object of code to number, so the order is whatever the aggregation
 * produced; sorting by count descending puts the reason a reader needs to act on at the top
 * instead of leaving them to scan. The empty message is a fact about the business, not a
 * report on the row count — "your AI handled every conversation on its own" is the same
 * information as "no handoffs" and answers the question the reader actually had.
 */
function Breakdown({
  title,
  counts,
  format,
  emptyMessage,
  tone,
}: {
  title: string;
  counts: Record<string, number>;
  format: (code: string) => string;
  emptyMessage: string;
  tone?: 'destructive';
}) {
  const rows = Object.entries(counts).sort(([, a], [, b]) => b - a);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map(([code, count]) => (
              <li key={code} className="flex items-baseline justify-between gap-3 text-sm">
                <span
                  className={cn(
                    'min-w-0',
                    tone === 'destructive' ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {format(code)}
                </span>
                <span className="shrink-0 font-medium tabular-nums text-muted-foreground">
                  {count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Latency at the granularity a person cares about: milliseconds until it becomes seconds. */
function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
