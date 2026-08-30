'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Zap,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Clock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormAlert } from '@/components/ui/form-alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { createAutomationAction, updateAutomationAction } from '@/server/actions/automation.actions';
import type { FormState } from '@/lib/form-state';
import { useActionState } from 'react';

export type ActionConfigItem = {
  id: string;
  type: string;
  config: Record<string, unknown>;
};

export type AutomationFormData = {
  id?: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  triggerType: string;
  triggerConfig?: Record<string, unknown> | null;
  actions: ActionConfigItem[];
};

export interface AutomationFormProps {
  initialData?: AutomationFormData;
  workspaceMembers?: Array<{ id: string; name: string }>;
  templateId?: string;
}

export function AutomationForm({
  initialData,
  templateId,
}: AutomationFormProps) {
  const isEditing = Boolean(initialData?.id);

  // Template defaults if templateId given
  const getInitialState = (): AutomationFormData => {
    if (initialData) return initialData;

    if (templateId === 'welcome-tag') {
      return {
        name: 'Welcome & Inquiry Tagging',
        description: 'Auto-reply to common greetings and tag contact as new inquiry.',
        isActive: true,
        triggerType: 'MESSAGE_CONTAINS',
        triggerConfig: {
          keywords: ['hi', 'hello', 'salam', 'hey', 'price'],
          matchMode: 'ANY',
          caseSensitive: false,
        },
        actions: [
          {
            id: 'act-1',
            type: 'SEND_MESSAGE',
            config: { body: 'Hello! Thank you for contacting us. How can we help you today?' },
          },
          {
            id: 'act-2',
            type: 'ADD_TAG',
            config: { tags: ['new-inquiry'] },
          },
        ],
      };
    }

    if (templateId === 'order-followup') {
      return {
        name: 'Order Confirmation Follow-up',
        description: 'Send delivery timeline advice 10 minutes after order is confirmed.',
        isActive: true,
        triggerType: 'ORDER_STATUS_CHANGED',
        triggerConfig: {
          fromStatus: 'PENDING',
          toStatus: 'CONFIRMED',
        },
        actions: [
          {
            id: 'act-1',
            type: 'WAIT',
            config: { durationMinutes: 10 },
          },
          {
            id: 'act-2',
            type: 'SEND_MESSAGE',
            config: {
              body: 'Your order is confirmed! Our courier will deliver within 2-3 business days. Thank you for shopping with us!',
            },
          },
          {
            id: 'act-3',
            type: 'ADD_TAG',
            config: { tags: ['order-confirmed'] },
          },
        ],
      };
    }

    if (templateId === 'idle-reminder') {
      return {
        name: 'Idle Conversation Reminder',
        description: 'Send a reminder message when customer has been inactive for 60 minutes.',
        isActive: true,
        triggerType: 'CONVERSATION_IDLE',
        triggerConfig: {
          idleMinutes: 60,
        },
        actions: [
          {
            id: 'act-1',
            type: 'SEND_MESSAGE',
            config: {
              body: 'Hi there! We wanted to check in — are you still looking to complete your order?',
            },
          },
          {
            id: 'act-2',
            type: 'NOTIFY_TEAM',
            config: {
              title: 'Idle customer follow-up sent',
              level: 'INFO',
            },
          },
        ],
      };
    }

    if (templateId === 'vip-escalation') {
      return {
        name: 'VIP Lead Escalation',
        description: 'Notify team and elevate priority when contact reaches Qualified stage.',
        isActive: true,
        triggerType: 'LEAD_STAGE_CHANGED',
        triggerConfig: {
          toStage: 'QUALIFIED',
        },
        actions: [
          {
            id: 'act-1',
            type: 'SET_PRIORITY',
            config: { priority: 'HIGH' },
          },
          {
            id: 'act-2',
            type: 'NOTIFY_TEAM',
            config: {
              title: 'High-value qualified lead',
              body: 'Customer progressed to Qualified lead stage. Review conversation.',
              level: 'WARNING',
            },
          },
          {
            id: 'act-3',
            type: 'CREATE_NOTE',
            config: {
              content: 'Auto-escalated to HIGH priority on reaching Qualified lead stage.',
            },
          },
        ],
      };
    }

    return {
      name: '',
      description: '',
      isActive: true,
      triggerType: 'MESSAGE_CONTAINS',
      triggerConfig: {
        keywords: ['help', 'order'],
        matchMode: 'ANY',
        caseSensitive: false,
      },
      actions: [
        {
          id: 'act-1',
          type: 'SEND_MESSAGE',
          config: { body: 'Hello! How can we assist you today?' },
        },
      ],
    };
  };

  const initialValues = getInitialState();

  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description ?? '');
  const [isActive, setIsActive] = useState(initialValues.isActive);
  const [triggerType, setTriggerType] = useState(initialValues.triggerType);
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(
    initialValues.triggerConfig ?? {},
  );
  const [actions, setActions] = useState<ActionConfigItem[]>(initialValues.actions);

  const initialId = initialData?.id ?? '';
  const actionFn = isEditing
    ? updateAutomationAction.bind(null, initialId)
    : createAutomationAction;

  const [state, formAction] = useActionState<FormState, FormData>(
    actionFn,
    { status: 'idle' },
  );

  // Trigger config handlers
  const handleKeywordsChange = (val: string) => {
    const arr = val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setTriggerConfig((prev) => ({ ...prev, keywords: arr }));
  };

  // Action list helpers
  const addAction = (type: string) => {
    const newId = `act-${Date.now()}`;
    let defaultCfg: Record<string, unknown> = {};

    switch (type) {
      case 'SEND_MESSAGE':
        defaultCfg = { body: 'Thank you for contacting us!' };
        break;
      case 'SEND_TEMPLATE':
        defaultCfg = { templateName: 'order_update' };
        break;
      case 'WAIT':
        defaultCfg = { durationMinutes: 10 };
        break;
      case 'ADD_TAG':
      case 'REMOVE_TAG':
        defaultCfg = { tags: ['follow-up'] };
        break;
      case 'SET_CONVERSATION_STATUS':
        defaultCfg = { status: 'OPEN' };
        break;
      case 'SET_PRIORITY':
        defaultCfg = { priority: 'HIGH' };
        break;
      case 'SET_LEAD_STAGE':
        defaultCfg = { stage: 'QUALIFIED' };
        break;
      case 'PAUSE_AI':
        defaultCfg = { reason: 'MANUAL_TAKEOVER' };
        break;
      case 'RESUME_AI':
        defaultCfg = {};
        break;
      case 'NOTIFY_TEAM':
        defaultCfg = { title: 'Automation Alert', body: '', level: 'INFO' };
        break;
      case 'CREATE_NOTE':
        defaultCfg = { content: 'Automated workflow executed.' };
        break;
    }

    setActions((prev) => [...prev, { id: newId, type, config: defaultCfg }]);
  };

  const removeAction = (index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
  };

  const moveAction = (index: number, direction: 'up' | 'down') => {
    setActions((prev) => {
      const copy = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= copy.length) return prev;
      const source = copy[index];
      const target = copy[targetIndex];
      if (!source || !target) return prev;
      copy[index] = target;
      copy[targetIndex] = source;
      return copy;
    });
  };

  const updateActionConfig = (index: number, key: string, value: unknown) => {
    setActions((prev) => {
      const copy = [...prev];
      const target = copy[index];
      if (!target) return prev;
      copy[index] = {
        ...target,
        config: {
          ...target.config,
          [key]: value,
        },
      };
      return copy;
    });
  };

  // Compile final JSON payload for form submit
  const payloadJson = JSON.stringify({
    name,
    description: description || null,
    isActive,
    triggerType,
    triggerConfig,
    actions: actions.map((act, idx) => ({
      position: idx,
      type: act.type,
      config: act.config,
    })),
  });

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={payloadJson} />

      <FormAlert state={state} />

      {/* 1. General Info */}
      <Card className="border-border bg-card/60">
        <CardHeader>
          <CardTitle className="text-base">General Information</CardTitle>
          <CardDescription>
            Give your automation rule a descriptive name and summary.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Workflow Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Order Confirmation Follow-up"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this automation do?"
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-3">
            <div>
              <div className="text-sm font-medium text-foreground">Activate Workflow</div>
              <div className="text-2xs text-muted-foreground">
                When active, incoming events will trigger this sequence automatically.
              </div>
            </div>
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              aria-label="Active status"
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. Trigger Configuration */}
      <Card className="border-border bg-card/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="size-4 text-primary" />
            Trigger Condition
          </CardTitle>
          <CardDescription>
            Choose what event starts this automation workflow.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="triggerType">Event Type</Label>
            <Select value={triggerType} onValueChange={setTriggerType}>
              <SelectTrigger id="triggerType">
                <SelectValue placeholder="Select trigger event" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MESSAGE_CONTAINS">Message Contains Keywords</SelectItem>
                <SelectItem value="MESSAGE_RECEIVED">Any Message Received</SelectItem>
                <SelectItem value="ORDER_STATUS_CHANGED">Order Status Changed</SelectItem>
                <SelectItem value="ORDER_CREATED">New Order Created</SelectItem>
                <SelectItem value="LEAD_STAGE_CHANGED">Lead Stage Changed</SelectItem>
                <SelectItem value="CONVERSATION_IDLE">Conversation Idle (Inactivity)</SelectItem>
                <SelectItem value="LOW_STOCK">Low Stock Alert</SelectItem>
                <SelectItem value="HANDOFF_REQUESTED">Human Handoff Requested</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Trigger Details */}
          {triggerType === 'MESSAGE_CONTAINS' && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                <Input
                  id="keywords"
                  value={Array.isArray(triggerConfig.keywords) ? triggerConfig.keywords.join(', ') : ''}
                  onChange={(e) => handleKeywordsChange(e.target.value)}
                  placeholder="e.g. price, cost, return, order"
                />
                <span className="text-2xs text-muted-foreground">
                  Matches if incoming customer message contains any of these terms.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="matchMode">Match Mode</Label>
                  <Select
                    value={(triggerConfig.matchMode as string) || 'ANY'}
                    onValueChange={(val) => setTriggerConfig((p) => ({ ...p, matchMode: val }))}
                  >
                    <SelectTrigger id="matchMode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANY">Any keyword (OR)</SelectItem>
                      <SelectItem value="ALL">All keywords (AND)</SelectItem>
                      <SelectItem value="EXACT">Exact text match</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <Switch
                    id="caseSensitive"
                    checked={Boolean(triggerConfig.caseSensitive)}
                    onCheckedChange={(val) => setTriggerConfig((p) => ({ ...p, caseSensitive: val }))}
                  />
                  <Label htmlFor="caseSensitive" className="text-xs cursor-pointer">
                    Case sensitive
                  </Label>
                </div>
              </div>
            </div>
          )}

          {triggerType === 'ORDER_STATUS_CHANGED' && (
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex flex-col gap-2">
                <Label>From Status (Optional)</Label>
                <Select
                  value={(triggerConfig.fromStatus as string) || 'ANY'}
                  onValueChange={(val) =>
                    setTriggerConfig((p) => ({ ...p, fromStatus: val === 'ANY' ? null : val }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Any status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ANY">Any previous status</SelectItem>
                    <SelectItem value="PENDING">PENDING</SelectItem>
                    <SelectItem value="CONFIRMED">CONFIRMED</SelectItem>
                    <SelectItem value="PROCESSING">PROCESSING</SelectItem>
                    <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                    <SelectItem value="DELIVERED">DELIVERED</SelectItem>
                    <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label>To Status</Label>
                <Select
                  value={(triggerConfig.toStatus as string) || 'CONFIRMED'}
                  onValueChange={(val) => setTriggerConfig((p) => ({ ...p, toStatus: val }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONFIRMED">CONFIRMED</SelectItem>
                    <SelectItem value="PROCESSING">PROCESSING</SelectItem>
                    <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                    <SelectItem value="DELIVERED">DELIVERED</SelectItem>
                    <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                    <SelectItem value="RETURNED">RETURNED</SelectItem>
                    <SelectItem value="REFUNDED">REFUNDED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {triggerType === 'LEAD_STAGE_CHANGED' && (
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-background/40 p-4">
              <div className="flex flex-col gap-2">
                <Label>From Stage</Label>
                <Select
                  value={(triggerConfig.fromStage as string) || 'ANY'}
                  onValueChange={(val) =>
                    setTriggerConfig((p) => ({ ...p, fromStage: val === 'ANY' ? null : val }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Any stage" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ANY">Any previous stage</SelectItem>
                    <SelectItem value="NEW">NEW</SelectItem>
                    <SelectItem value="CONTACTED">CONTACTED</SelectItem>
                    <SelectItem value="QUALIFIED">QUALIFIED</SelectItem>
                    <SelectItem value="INTERESTED">INTERESTED</SelectItem>
                    <SelectItem value="NEGOTIATION">NEGOTIATION</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label>To Stage</Label>
                <Select
                  value={(triggerConfig.toStage as string) || 'QUALIFIED'}
                  onValueChange={(val) => setTriggerConfig((p) => ({ ...p, toStage: val }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONTACTED">CONTACTED</SelectItem>
                    <SelectItem value="QUALIFIED">QUALIFIED</SelectItem>
                    <SelectItem value="INTERESTED">INTERESTED</SelectItem>
                    <SelectItem value="NEGOTIATION">NEGOTIATION</SelectItem>
                    <SelectItem value="CONVERTED">CONVERTED</SelectItem>
                    <SelectItem value="LOST">LOST</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {triggerType === 'CONVERSATION_IDLE' && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-4">
              <Label htmlFor="idleMinutes">Idle Duration (Minutes)</Label>
              <Input
                id="idleMinutes"
                type="number"
                min={1}
                max={10080}
                value={(triggerConfig.idleMinutes as number) ?? 60}
                onChange={(e) =>
                  setTriggerConfig((p) => ({ ...p, idleMinutes: parseInt(e.target.value, 10) || 60 }))
                }
              />
              <span className="text-2xs text-muted-foreground">
                Triggers when customer and team have not sent a message in this conversation for X minutes.
              </span>
            </div>
          )}

          {triggerType === 'LOW_STOCK' && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-4">
              <Label htmlFor="threshold">Low Stock Threshold</Label>
              <Input
                id="threshold"
                type="number"
                min={0}
                max={1000}
                value={(triggerConfig.threshold as number) ?? 5}
                onChange={(e) =>
                  setTriggerConfig((p) => ({ ...p, threshold: parseInt(e.target.value, 10) || 5 }))
                }
              />
              <span className="text-2xs text-muted-foreground">
                Fires when available units drop to or below this amount.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Actions Sequence Builder */}
      <Card className="border-border bg-card/60">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Action Sequence</CardTitle>
            <CardDescription>
              Actions will execute sequentially from top to bottom.
            </CardDescription>
          </div>

          <Select onValueChange={addAction}>
            <SelectTrigger className="w-[170px]">
              <Plus className="mr-1.5 size-3.5" />
              <span>Add Action Step</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SEND_MESSAGE">Send Message</SelectItem>
              <SelectItem value="SEND_TEMPLATE">Send Template</SelectItem>
              <SelectItem value="WAIT">Wait / Delay</SelectItem>
              <SelectItem value="ADD_TAG">Add Contact Tag</SelectItem>
              <SelectItem value="REMOVE_TAG">Remove Contact Tag</SelectItem>
              <SelectItem value="SET_CONVERSATION_STATUS">Set Conversation Status</SelectItem>
              <SelectItem value="SET_PRIORITY">Set Priority</SelectItem>
              <SelectItem value="SET_LEAD_STAGE">Set Lead Stage</SelectItem>
              <SelectItem value="PAUSE_AI">Pause AI Employee</SelectItem>
              <SelectItem value="RESUME_AI">Resume AI Employee</SelectItem>
              <SelectItem value="NOTIFY_TEAM">Notify Team</SelectItem>
              <SelectItem value="CREATE_NOTE">Create Internal Note</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {actions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No actions configured. Click <strong>Add Action Step</strong> above to define workflow steps.
            </div>
          ) : (
            actions.map((act, index) => (
              <div
                key={act.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-2xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <span className="text-xs font-semibold text-foreground">
                      {act.type.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => moveAction(index, 'up')}
                      aria-label="Move up"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === actions.length - 1}
                      onClick={() => moveAction(index, 'down')}
                      aria-label="Move down"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAction(index)}
                      className="text-destructive hover:bg-destructive/10"
                      aria-label="Remove action"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Specific Action Inputs */}
                {act.type === 'SEND_MESSAGE' && (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Message Body</Label>
                    <Textarea
                      value={(act.config.body as string) || ''}
                      onChange={(e) => updateActionConfig(index, 'body', e.target.value)}
                      placeholder="Type message text..."
                      rows={2}
                    />
                  </div>
                )}

                {act.type === 'SEND_TEMPLATE' && (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Meta Template Name</Label>
                    <Input
                      value={(act.config.templateName as string) || ''}
                      onChange={(e) => updateActionConfig(index, 'templateName', e.target.value)}
                      placeholder="e.g. order_confirmed"
                    />
                  </div>
                )}

                {act.type === 'WAIT' && (
                  <div className="flex items-center gap-3">
                    <Clock className="size-4 text-muted-foreground" />
                    <div className="flex flex-1 items-center gap-2">
                      <Label className="text-xs shrink-0">Wait for</Label>
                      <Input
                        type="number"
                        min={1}
                        max={43200}
                        value={(act.config.durationMinutes as number) || 10}
                        onChange={(e) =>
                          updateActionConfig(
                            index,
                            'durationMinutes',
                            parseInt(e.target.value, 10) || 1,
                          )
                        }
                        className="w-24"
                      />
                      <span className="text-xs text-muted-foreground">minutes before next action</span>
                    </div>
                  </div>
                )}

                {(act.type === 'ADD_TAG' || act.type === 'REMOVE_TAG') && (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Tag Name(s) (comma-separated)</Label>
                    <Input
                      value={
                        Array.isArray(act.config.tags)
                          ? (act.config.tags as string[]).join(', ')
                          : (act.config.tag as string) || ''
                      }
                      onChange={(e) => {
                        const tags = e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean);
                        updateActionConfig(index, 'tags', tags);
                      }}
                      placeholder="e.g. vip, follow-up, pending-payment"
                    />
                  </div>
                )}

                {act.type === 'SET_CONVERSATION_STATUS' && (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">New Status</Label>
                    <Select
                      value={(act.config.status as string) || 'OPEN'}
                      onValueChange={(val) => updateActionConfig(index, 'status', val)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OPEN">OPEN</SelectItem>
                        <SelectItem value="PENDING">PENDING</SelectItem>
                        <SelectItem value="RESOLVED">RESOLVED</SelectItem>
                        <SelectItem value="CLOSED">CLOSED</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {act.type === 'SET_PRIORITY' && (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Priority</Label>
                    <Select
                      value={(act.config.priority as string) || 'HIGH'}
                      onValueChange={(val) => updateActionConfig(index, 'priority', val)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">LOW</SelectItem>
                        <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                        <SelectItem value="HIGH">HIGH</SelectItem>
                        <SelectItem value="URGENT">URGENT</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {act.type === 'SET_LEAD_STAGE' && (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Lead Stage</Label>
                    <Select
                      value={(act.config.stage as string) || 'QUALIFIED'}
                      onValueChange={(val) => updateActionConfig(index, 'stage', val)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NEW">NEW</SelectItem>
                        <SelectItem value="CONTACTED">CONTACTED</SelectItem>
                        <SelectItem value="QUALIFIED">QUALIFIED</SelectItem>
                        <SelectItem value="INTERESTED">INTERESTED</SelectItem>
                        <SelectItem value="NEGOTIATION">NEGOTIATION</SelectItem>
                        <SelectItem value="CONVERTED">CONVERTED</SelectItem>
                        <SelectItem value="LOST">LOST</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {act.type === 'PAUSE_AI' && (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Handoff / Pause Reason</Label>
                    <Select
                      value={(act.config.reason as string) || 'MANUAL_TAKEOVER'}
                      onValueChange={(val) => updateActionConfig(index, 'reason', val)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MANUAL_TAKEOVER">Manual Takeover</SelectItem>
                        <SelectItem value="LOW_CONFIDENCE">Low AI Confidence</SelectItem>
                        <SelectItem value="CUSTOMER_REQUEST">Customer Requested Human</SelectItem>
                        <SelectItem value="PAYMENT_ISSUE">Payment Issue</SelectItem>
                        <SelectItem value="OUTSIDE_BUSINESS_HOURS">Outside Business Hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {act.type === 'NOTIFY_TEAM' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">Notification Title</Label>
                      <Input
                        value={(act.config.title as string) || ''}
                        onChange={(e) => updateActionConfig(index, 'title', e.target.value)}
                        placeholder="Alert title..."
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs">Severity Level</Label>
                      <Select
                        value={(act.config.level as string) || 'INFO'}
                        onValueChange={(val) => updateActionConfig(index, 'level', val)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="INFO">INFO</SelectItem>
                          <SelectItem value="WARNING">WARNING</SelectItem>
                          <SelectItem value="CRITICAL">CRITICAL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {act.type === 'CREATE_NOTE' && (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Internal Note Content</Label>
                    <Textarea
                      value={(act.config.content as string) || ''}
                      onChange={(e) => updateActionConfig(index, 'content', e.target.value)}
                      placeholder="Note to attach to audit history..."
                      rows={2}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Buttons */}
      <div className="flex items-center justify-end gap-3">
        <Button asChild variant="outline">
          <Link href="/automations">Cancel</Link>
        </Button>
        <SubmitButton>
          {isEditing ? 'Save Changes' : 'Create Automation'}
        </SubmitButton>
      </div>
    </form>
  );
}
