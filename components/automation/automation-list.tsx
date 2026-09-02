'use client';

/**
 * The automations table.
 *
 * One row per rule, and the row states the whole rule in words: what starts it, then every
 * step in order. It used to render each step as a small chip with its own glyph, which meant
 * a rule with four steps became four coloured objects that took longer to read than the four
 * words they replaced — and the trigger came from a local table covering ten of the thirteen
 * triggers, so a rule started by a new customer or an incoming payment showed
 * `CONTACT_CREATED` to the shop owner.
 *
 * The switch is the only thing in the row that changes anything without leaving the page, so
 * everything slower — editing, testing, deleting — lives behind the row menu, and the two
 * that cannot be undone by flicking the switch back ask first.
 */

import { MoreVertical, Pencil, Play, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { FormAlert } from '@/components/ui/form-alert';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state';
import { actionTypeLabel, triggerTypeLabel } from '@/lib/labels';
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
  /** Rendered inside the card below the table — where the page puts its pagination. */
  footer?: React.ReactNode;
}

/** How often a rule has run, in the phrasing used on a phone where there is no Runs column. */
function runsSummary(runs: number): string {
  if (runs === 0) return 'never run';
  return `${runs.toLocaleString()} run${runs === 1 ? '' : 's'}`;
}

export function AutomationList({
  automations,
  canEdit = true,
  canDelete = true,
  footer,
}: AutomationListProps) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>(IDLE_FORM_STATE);
  const [deleteTarget, setDeleteTarget] = useState<AutomationItem | null>(null);
  const [testTarget, setTestTarget] = useState<AutomationItem | null>(null);

  const handleToggle = (automation: AutomationItem) => {
    startTransition(async () => {
      setState(await toggleAutomationAction(automation.id, !automation.isActive));
    });
  };

  const handleTestRun = () => {
    if (!testTarget) return;
    startTransition(async () => {
      const result = await testTriggerAutomationAction(testTarget.id);
      setState(result);
      setTestTarget(null);
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      // Deleting redirects back to this page on success, so a returned state only ever
      // describes a failure.
      const result = await deleteAutomationAction(deleteTarget.id);
      if (result?.status === 'error') setState(result);
      setDeleteTarget(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <FormAlert state={state} />

      <Card className="overflow-hidden">
        <TableContainer>
          <Table aria-label="Automations">
            <TableHeader>
              <TableRow>
                <TableHead>Automation</TableHead>
                <TableHead className="hidden md:table-cell">When</TableHead>
                <TableHead numeric className="hidden md:table-cell">
                  Runs
                </TableHead>
                <TableHead className="w-px">
                  <span className="sr-only">On or off, and more</span>
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {automations.map((automation) => (
                <TableRow key={automation.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Link
                        href={`/automations/${automation.id}`}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {automation.name}
                      </Link>

                      {automation.description ? (
                        <p className="max-w-prose text-sm text-muted-foreground">
                          {automation.description}
                        </p>
                      ) : null}

                      <p className="text-sm text-muted-foreground">
                        <ActionPipeline actions={automation.actions} />
                      </p>

                      {/* Below md the trigger and the run count have no column of their own,
                          so they fold in here rather than disappearing. */}
                      <p className="text-sm text-muted-foreground md:hidden">
                        When {triggerTypeLabel(automation.triggerType)} ·{' '}
                        {runsSummary(automation._count.runs)}
                      </p>
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    {triggerTypeLabel(automation.triggerType)}
                  </TableCell>

                  <TableCell numeric className="hidden md:table-cell">
                    {automation._count.runs.toLocaleString()}
                  </TableCell>

                  <TableCell className="w-px whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit ? (
                        <Switch
                          checked={automation.isActive}
                          onCheckedChange={() => handleToggle(automation)}
                          disabled={isPending}
                          aria-label={`Turn ${automation.name} on and off`}
                        />
                      ) : (
                        // Without the switch there is nothing in the row saying whether the
                        // rule is running, and that is the first thing anyone wants to know.
                        <Badge variant={automation.isActive ? 'success' : 'muted'}>
                          {automation.isActive ? 'On' : 'Off'}
                        </Badge>
                      )}

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`More for ${automation.name}`}
                          >
                            <MoreVertical aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/automations/${automation.id}`}>
                              <Pencil aria-hidden />
                              {canEdit ? 'Edit' : 'View'}
                            </Link>
                          </DropdownMenuItem>

                          {canEdit ? (
                            <DropdownMenuItem
                              onClick={() => setTestTarget(automation)}
                              disabled={isPending}
                            >
                              <Play aria-hidden />
                              Test run…
                            </DropdownMenuItem>
                          ) : null}

                          {canDelete ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(automation)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 aria-hidden />
                                Delete
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {footer}
      </Card>

      <Dialog open={Boolean(testTarget)} onOpenChange={() => setTestTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Test run {testTarget?.name}?</DialogTitle>
            <DialogDescription>
              The rule runs for real. It picks one of your existing conversations and uses
              stand-in details in place of a real event, so anything it does there — a tag, a
              note, a change of status or priority, an alert to your team — stays. Any other rule
              that starts on the same event runs too.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTestTarget(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleTestRun} disabled={isPending}>
              {isPending ? 'Running…' : 'Test run'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              Its steps and its whole run history go with it, and none of that can be brought
              back. If you only want it to stop, turn it off instead.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? 'Deleting…' : 'Delete automation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The steps in order, as a sentence.
 *
 * Sorted here rather than trusted, because the order is the rule: "wait, then message" and
 * "message, then wait" are different automations.
 */
function ActionPipeline({ actions }: { actions: ActionItemSummary[] }) {
  if (actions.length === 0) {
    return <>No steps yet, so it does nothing</>;
  }

  const ordered = [...actions].sort((left, right) => left.position - right.position);

  return (
    <>
      {ordered.map((action, index) => (
        <span key={action.id}>
          {index > 0 ? (
            <>
              <span aria-hidden> → </span>
              <span className="sr-only">, then </span>
            </>
          ) : null}
          {actionTypeLabel(action.type)}
        </span>
      ))}
    </>
  );
}
