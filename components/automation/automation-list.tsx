'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  MoreVertical,
  Play,
  Pencil,
  Trash2,
  Zap,
  Clock,
  Tag,
  MessageSquare,
  Bot,
  UserCheck,
  Bell,
  FileText,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import {
  deleteAutomationAction,
  testTriggerAutomationAction,
  toggleAutomationAction,
} from '@/server/actions/automation.actions';

export type ActionItemSummary = {
  id: string;
  position: number;
  type: string;
  config: Record<string, unknown>;
};

export type AutomationItem = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  triggerType: string;
  triggerConfig: Record<string, unknown> | null;
  actions: ActionItemSummary[];
  _count: { runs: number };
  createdAt: string;
  updatedAt: string;
};

export interface AutomationListProps {
  automations: AutomationItem[];
  canEdit?: boolean;
  canDelete?: boolean;
}

export function AutomationList({
  automations,
  canEdit = true,
  canDelete = true,
}: AutomationListProps) {
  const [isPending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<AutomationItem | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleToggle = (auto: AutomationItem) => {
    startTransition(async () => {
      const res = await toggleAutomationAction(auto.id, !auto.isActive);
      if (res.status === 'error') {
        setMessage({ type: 'error', text: res.message || 'Failed to toggle status.' });
      } else {
        setMessage({ type: 'success', text: res.message || 'Status updated.' });
      }
    });
  };

  const handleTestRun = (auto: AutomationItem) => {
    startTransition(async () => {
      const res = await testTriggerAutomationAction(auto.id);
      if (res.status === 'error') {
        setMessage({ type: 'error', text: res.message || 'Test trigger failed.' });
      } else {
        setMessage({ type: 'success', text: res.message || 'Test run initiated.' });
      }
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const res = await deleteAutomationAction(deleteTarget.id);
      if (res.status === 'error') {
        setMessage({ type: 'error', text: res.message || 'Failed to delete automation.' });
      }
      setDeleteTarget(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <div
          className={`flex items-center justify-between rounded-lg px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <AlertCircle className="size-4" />
            )}
            <span>{message.text}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMessage(null)}
            className="h-auto p-1 text-xs"
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {automations.map((auto) => (
          <Card
            key={auto.id}
            className={`border-border bg-card/60 transition-all hover:bg-card ${
              !auto.isActive ? 'opacity-80' : ''
            }`}
          >
            <CardContent className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 flex-col gap-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/automations/${auto.id}`}
                      className="font-semibold text-foreground hover:underline hover:text-primary"
                    >
                      {auto.name}
                    </Link>
                    <Badge variant={auto.isActive ? 'default' : 'secondary'} className="text-3xs">
                      {auto.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    <TriggerBadge triggerType={auto.triggerType} />
                  </div>

                  {auto.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {auto.description}
                    </p>
                  )}

                  {/* Actions Pipeline Badges */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-2xs font-medium text-muted-foreground mr-1">Actions:</span>
                    {auto.actions.length === 0 ? (
                      <span className="text-2xs text-muted-foreground italic">No actions defined</span>
                    ) : (
                      auto.actions.map((act, i) => (
                        <div key={act.id || i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted-foreground text-3xs">→</span>}
                          <ActionBadge type={act.type} />
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <div className="text-right">
                    <div className="text-xs font-semibold text-foreground">
                      {auto._count.runs} runs
                    </div>
                    <div className="text-3xs text-muted-foreground">executed</div>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={auto.isActive}
                        onCheckedChange={() => handleToggle(auto)}
                        disabled={isPending}
                        aria-label={`Toggle ${auto.name}`}
                      />
                    </div>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Open menu">
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/automations/${auto.id}`} className="flex items-center gap-2">
                          <Pencil className="size-3.5" />
                          <span>Edit Workflow</span>
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleTestRun(auto)}
                        disabled={isPending}
                        className="flex items-center gap-2"
                      >
                        <Play className="size-3.5 text-primary" />
                        <span>Run Test Trigger</span>
                      </DropdownMenuItem>
                      {canDelete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(auto)}
                            className="flex items-center gap-2 text-destructive focus:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Delete Confirmation Modal */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Automation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? All
              configured actions and run logs for this automation will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? 'Deleting...' : 'Delete Automation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TriggerBadge({ triggerType }: { triggerType: string }) {
  const triggerLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
    MESSAGE_CONTAINS: { label: 'Message Contains', variant: 'outline' },
    MESSAGE_RECEIVED: { label: 'Message Received', variant: 'outline' },
    CONVERSATION_OPENED: { label: 'Chat Opened', variant: 'outline' },
    CONVERSATION_IDLE: { label: 'Chat Idle', variant: 'secondary' },
    CONVERSATION_RESOLVED: { label: 'Chat Resolved', variant: 'outline' },
    ORDER_CREATED: { label: 'Order Created', variant: 'outline' },
    ORDER_STATUS_CHANGED: { label: 'Order Status Changed', variant: 'default' },
    LEAD_STAGE_CHANGED: { label: 'Lead Stage Changed', variant: 'default' },
    LOW_STOCK: { label: 'Low Stock Alert', variant: 'secondary' },
    HANDOFF_REQUESTED: { label: 'Handoff Requested', variant: 'secondary' },
  };

  const info = triggerLabels[triggerType] || { label: triggerType, variant: 'outline' };
  return (
    <Badge variant={info.variant} className="text-3xs font-medium">
      <Zap className="mr-1 size-2.5" />
      {info.label}
    </Badge>
  );
}

function ActionBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; icon: typeof MessageSquare }> = {
    SEND_MESSAGE: { label: 'Send Message', icon: MessageSquare },
    SEND_TEMPLATE: { label: 'Send Template', icon: MessageSquare },
    WAIT: { label: 'Wait', icon: Clock },
    ADD_TAG: { label: 'Add Tag', icon: Tag },
    REMOVE_TAG: { label: 'Remove Tag', icon: Tag },
    ASSIGN_CONVERSATION: { label: 'Assign', icon: UserCheck },
    SET_CONVERSATION_STATUS: { label: 'Set Status', icon: Zap },
    SET_PRIORITY: { label: 'Set Priority', icon: Zap },
    SET_LEAD_STAGE: { label: 'Set Stage', icon: Zap },
    PAUSE_AI: { label: 'Pause AI', icon: Bot },
    RESUME_AI: { label: 'Resume AI', icon: Bot },
    NOTIFY_TEAM: { label: 'Notify Team', icon: Bell },
    CREATE_NOTE: { label: 'Create Note', icon: FileText },
  };

  const item = map[type] || { label: type, icon: Zap };
  const Icon = item.icon;

  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-3xs font-medium text-foreground">
      <Icon className="size-2.5 text-muted-foreground" />
      {item.label}
    </span>
  );
}
