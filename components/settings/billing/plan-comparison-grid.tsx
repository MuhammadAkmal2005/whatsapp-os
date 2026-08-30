'use client';

import { Check, ShieldAlert, Sparkles, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { Plan, PlanKey } from '@/config/plans';

function formatMinorToPkr(minor: number): string {
  if (minor === 0) return 'Free';
  const major = Math.round(minor / 100);
  return `Rs. ${major.toLocaleString('en-PK')}`;
}

const FEATURE_LABELS: Record<string, string> = {
  ai_agent: 'AI Employee with Grounded RAG',
  knowledge_base: 'Knowledge Base Document Sync',
  human_handoff: 'Automated Human Handoff',
  automations: 'Event & Keyword Automations',
  analytics: 'Analytics & Usage KPIs',
  advanced_analytics: 'Advanced Rollups & CSV Exports',
  multiple_numbers: 'Multiple WhatsApp Numbers',
  campaigns: 'Broadcast Marketing Campaigns',
  appointments: 'Appointment Booking Engine',
  api_access: 'Developer API & Webhook Access',
  priority_support: 'Priority Support & SLA',
  audit_log_export: 'Compliance & Audit Log Exports',
};

interface PlanComparisonGridProps {
  plans: Plan[];
  activePlanKey: PlanKey;
  canManage: boolean;
  onSelectPlan: (planKey: PlanKey) => Promise<void>;
  isActionLoading: boolean;
  pendingPlanKey: PlanKey | null;
}

export function PlanComparisonGrid({
  plans,
  activePlanKey,
  canManage,
  onSelectPlan,
  isActionLoading,
  pendingPlanKey,
}: PlanComparisonGridProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-foreground">
            Available Plans & Upgrades
          </h3>
          <p className="text-xs text-muted-foreground">
            Transparent pricing with no hidden charges. All plans include automated customer support and fail-safe human handoff.
          </p>
        </div>
        {!canManage && (
          <div className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md">
            <ShieldAlert className="size-3.5" />
            <span>Only workspace owners can modify subscriptions</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map((p) => {
          const isCurrent = p.key === activePlanKey;
          const isPending = isActionLoading && pendingPlanKey === p.key;

          return (
            <Card
              key={p.key}
              className={`flex flex-col justify-between relative transition-all duration-200 ${
                p.highlighted
                  ? 'border-primary shadow-md ring-1 ring-primary/20'
                  : isCurrent
                    ? 'border-emerald-400/80 bg-emerald-50/20'
                    : 'border-border/80'
              }`}
            >
              {p.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground text-xs px-2.5 py-0.5 shadow-sm">
                    <Sparkles className="mr-1 size-3" />
                    Most Popular
                  </Badge>
                </div>
              )}

              <CardHeader className="pb-3 pt-5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-bold text-foreground">
                    {p.name}
                  </CardTitle>
                  {isCurrent && (
                    <Badge variant="outline" className="text-xs bg-emerald-100 text-emerald-800 border-emerald-300">
                      Current
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs min-h-[32px] line-clamp-2 mt-1">
                  {p.tagline}
                </CardDescription>

                <div className="mt-3">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold tracking-tight text-foreground">
                      {formatMinorToPkr(p.priceMinor)}
                    </span>
                    {p.priceMinor > 0 && (
                      <span className="text-xs text-muted-foreground">/{p.interval}</span>
                    )}
                  </div>
                  {p.trialDays > 0 && (
                    <p className="text-[11px] text-blue-600 font-medium mt-0.5">
                      {p.trialDays}-day free trial included
                    </p>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-3 flex-1 pb-4 text-xs">
                {/* Core Limits Summary */}
                <div className="space-y-1.5 p-2.5 rounded-md bg-muted/50 border border-border/40">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">WhatsApp Numbers:</span>
                    <strong className="font-semibold text-foreground">
                      {p.limits.whatsappNumbers ?? 'Unlimited'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Automations:</span>
                    <strong className="font-semibold text-foreground">
                      {p.limits.automations ?? 'Unlimited'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contacts / CRM:</span>
                    <strong className="font-semibold text-foreground">
                      {p.limits.contacts !== null ? p.limits.contacts.toLocaleString() : 'Unlimited'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Catalogue Products:</span>
                    <strong className="font-semibold text-foreground">
                      {p.limits.products !== null ? p.limits.products.toLocaleString() : 'Unlimited'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">AI Requests (mo):</span>
                    <strong className="font-semibold text-foreground">
                      {p.limits.aiRequestsPerMonth !== null ? p.limits.aiRequestsPerMonth.toLocaleString() : 'Unlimited'}
                    </strong>
                  </div>
                </div>

                {/* Features List */}
                <div className="space-y-1.5 pt-1">
                  <p className="font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">
                    Included Features
                  </p>
                  <ul className="space-y-1">
                    {p.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-1.5 text-foreground/90">
                        <Check className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{FEATURE_LABELS[feat] ?? feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>

              <CardFooter className="pt-2 pb-4">
                {isCurrent ? (
                  <Button variant="outline" className="w-full text-xs h-9" disabled>
                    Current Plan
                  </Button>
                ) : (
                  <Button
                    variant={p.highlighted ? 'default' : 'outline'}
                    className={`w-full text-xs h-9 font-medium ${
                      p.highlighted ? 'shadow-sm' : ''
                    }`}
                    disabled={!canManage || isActionLoading}
                    onClick={() => onSelectPlan(p.key)}
                  >
                    {isPending ? (
                      <>
                        <Spinner className="mr-1.5 size-3" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <Zap className="mr-1.5 size-3" />
                        {p.priceMinor > 0 ? `Switch to ${p.name}` : 'Switch to Free'}
                      </>
                    )}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
