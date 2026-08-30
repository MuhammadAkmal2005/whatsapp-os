'use client';

import { Zap, PlayCircle, CheckCircle2, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export interface AutomationStatsProps {
  total: number;
  active: number;
  totalRuns: number;
  recentRunsCount: number;
}

export function AutomationStats({
  total,
  active,
  totalRuns,
  recentRunsCount,
}: AutomationStatsProps) {
  const cards = [
    {
      label: 'Total Automations',
      value: total,
      icon: Zap,
      description: 'Configured workflows',
      color: 'text-primary',
    },
    {
      label: 'Active Workflows',
      value: active,
      icon: PlayCircle,
      description: `${total > 0 ? Math.round((active / total) * 100) : 0}% of all rules`,
      color: 'text-emerald-500',
    },
    {
      label: 'Total Executions',
      value: totalRuns,
      icon: CheckCircle2,
      description: 'Completed automation runs',
      color: 'text-blue-500',
    },
    {
      label: 'Recent Runs',
      value: recentRunsCount,
      icon: Clock,
      description: 'Triggered in recent sessions',
      color: 'text-amber-500',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="border-border bg-card/60">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {card.label}
                </span>
                <Icon className={`size-4 ${card.color}`} aria-hidden />
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
                {card.value}
              </div>
              <p className="mt-1 text-2xs text-muted-foreground">
                {card.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
