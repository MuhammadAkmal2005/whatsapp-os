'use client';

import Link from 'next/link';
import { MessageSquare, ShoppingBag, Clock, Sparkles, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  icon: typeof MessageSquare;
  triggerType: string;
  actionsCount: number;
  triggerBadge: string;
}

export const PRESET_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: 'welcome-tag',
    name: 'Welcome & Inquiry Auto-Tag',
    description: 'Instantly greet inbound inquiries and attach a "new-inquiry" tag to the customer.',
    icon: MessageSquare,
    triggerType: 'MESSAGE_CONTAINS',
    actionsCount: 2,
    triggerBadge: 'Message Contains',
  },
  {
    id: 'order-followup',
    name: 'Order Confirmation Follow-up',
    description: 'Wait 10 minutes after order confirmation, then message delivery details and tips.',
    icon: ShoppingBag,
    triggerType: 'ORDER_STATUS_CHANGED',
    actionsCount: 3,
    triggerBadge: 'Order Confirmed',
  },
  {
    id: 'idle-reminder',
    name: 'Idle Chat Follow-up',
    description: 'Check in on conversations idle for 60 minutes and notify your sales team.',
    icon: Clock,
    triggerType: 'CONVERSATION_IDLE',
    actionsCount: 2,
    triggerBadge: 'Idle (60m)',
  },
  {
    id: 'vip-escalation',
    name: 'VIP Lead Escalation',
    description: 'Elevate priority to Urgent and alert staff when a customer reaches Qualified lead stage.',
    icon: Sparkles,
    triggerType: 'LEAD_STAGE_CHANGED',
    actionsCount: 3,
    triggerBadge: 'Lead Qualified',
  },
];

export function TemplatePicker() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Quick-Start Templates
        </h2>
        <span className="text-xs text-muted-foreground">
          Click any preset to pre-fill the workflow builder
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PRESET_TEMPLATES.map((tmpl) => {
          const Icon = tmpl.icon;
          return (
            <Link
              key={tmpl.id}
              href={`/automations/new?template=${tmpl.id}`}
              className="group block"
            >
              <Card className="h-full border-border bg-card/60 transition-all hover:border-primary/50 hover:bg-card hover:shadow-sm">
                <CardContent className="flex h-full flex-col justify-between p-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-4" aria-hidden />
                      </div>
                      <Badge variant="outline" className="text-3xs">
                        {tmpl.triggerBadge}
                      </Badge>
                    </div>

                    <h3 className="mt-3 text-sm font-medium text-foreground group-hover:text-primary">
                      {tmpl.name}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {tmpl.description}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs font-medium text-primary">
                    <span>{tmpl.actionsCount} actions</span>
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
