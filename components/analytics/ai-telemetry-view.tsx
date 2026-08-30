import { Bot, CheckCircle2, Cpu, ShieldAlert, Sparkles, UserCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/dashboard/stat-card';
import type { AITelemetryBreakdown } from '@/server/repositories/analytics.repository';

interface AITelemetryViewProps {
  telemetry: AITelemetryBreakdown;
}

export function AITelemetryView({ telemetry }: AITelemetryViewProps) {
  const costFormatted = `$${(telemetry.totalCostMicros / 1000000).toFixed(4)} USD`;
  const totalTokens = telemetry.totalInputTokens + telemetry.totalOutputTokens;

  return (
    <div className="flex flex-col gap-6">
      {/* Top AI Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total AI Requests"
          value={telemetry.totalRequests.toLocaleString()}
          icon={Bot}
          hint={`${totalTokens.toLocaleString()} total tokens`}
        />

        <StatCard
          label="Grounding Pass Rate"
          value={`${telemetry.groundingPassRate}%`}
          icon={CheckCircle2}
          hint="Responses grounded in business facts"
          tone={telemetry.groundingPassRate >= 95 ? 'default' : 'warning'}
        />

        <StatCard
          label="Token Consumption"
          value={totalTokens.toLocaleString()}
          icon={Cpu}
          hint={`${telemetry.totalInputTokens.toLocaleString()} in / ${telemetry.totalOutputTokens.toLocaleString()} out`}
        />

        <StatCard
          label="Estimated AI Cost"
          value={costFormatted}
          icon={Sparkles}
          hint={`${telemetry.totalCostMicros.toLocaleString()} µUSD computed`}
        />
      </div>

      {/* Model Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Model Usage & Cost Attribution</CardTitle>
          <CardDescription>
            Performance, token consumption, and compute costs segmented by model.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {telemetry.byModel.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No AI model executions logged for this time window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground font-medium">
                    <th className="pb-3 pr-4">Model</th>
                    <th className="pb-3 pr-4">Provider</th>
                    <th className="pb-3 pr-4 text-right">Requests</th>
                    <th className="pb-3 pr-4 text-right">Input Tokens</th>
                    <th className="pb-3 pr-4 text-right">Output Tokens</th>
                    <th className="pb-3 pr-4 text-right">Total Tokens</th>
                    <th className="pb-3 pr-4 text-right">Avg Latency</th>
                    <th className="pb-3 text-right">Cost (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {telemetry.byModel.map((row) => (
                    <tr key={`${row.provider}:${row.model}`} className="hover:bg-muted/50">
                      <td className="py-3 pr-4 font-mono font-medium">{row.model}</td>
                      <td className="py-3 pr-4">
                        <Badge variant="outline" className="capitalize">
                          {row.provider}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-right">{row.requests.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right font-mono">{row.inputTokens.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right font-mono">{row.outputTokens.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right font-mono">{row.totalTokens.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-right">{row.avgLatencyMs} ms</td>
                      <td className="py-3 text-right font-medium">
                        ${(row.costMicros / 1000000).toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Breakdowns Row: Sources, Handoffs, Grounding Blocks */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Source breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Execution Source
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(telemetry.bySource).length === 0 ? (
              <p className="text-xs text-muted-foreground">No sources recorded.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(telemetry.bySource).map(([source, count]) => (
                  <div key={source} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{source.toLowerCase().replace(/_/g, ' ')}</span>
                    <span className="font-semibold">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Handoff reasons */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-amber-500" />
              Handoff Reasons
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(telemetry.byHandoffReason).length === 0 ? (
              <p className="text-xs text-muted-foreground">No escalations/handoffs triggered.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(telemetry.byHandoffReason).map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between text-sm">
                    <span className="text-xs font-mono">{reason}</span>
                    <Badge variant="outline">{count.toLocaleString()}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Blocked reasons */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
              Safety & Grounding Blocks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(telemetry.byBlockedReason).length === 0 ? (
              <p className="text-xs text-muted-foreground">Zero ungrounded hallucinations blocked.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(telemetry.byBlockedReason).map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between text-sm">
                    <span className="text-xs font-mono text-rose-600 dark:text-rose-400">
                      {reason}
                    </span>
                    <Badge variant="danger">{count.toLocaleString()}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
