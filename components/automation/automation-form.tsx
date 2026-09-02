'use client';

/**
 * The automation builder.
 *
 * A rule is one starting event and a list of steps, and this screen is those two things in that
 * order. The whole rule is posted as a single JSON payload in a hidden field rather than as loose
 * inputs, because the steps are a nested, reorderable list that no flat form encoding describes
 * well — the server's Zod errors still arrive keyed by dot-joined path (`name`, `actions.0.type`),
 * so each field can show its own message.
 *
 * Two things this refuses to do. It will not offer a choice the database would reject: every
 * picker is built from the shared validation lists, which is how the old MEDIUM priority,
 * CUSTOMER_REQUEST reason and CRITICAL alert level are gone. And it will not save a rule that
 * cannot work — no steps, no keywords to match, a message step with nothing to send — because a
 * rule that saves and then does nothing is worse than one that refuses to save.
 */

import { AlertTriangle, ArrowDown, ArrowUp, ListPlus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';

import { defaultActionConfig, StepFields, stepBlocker } from '@/components/automation/automation-step-fields';
import {
  defaultTriggerConfig,
  TriggerFields,
} from '@/components/automation/automation-trigger-fields';
import { MessageDeliveryNote } from '@/components/automation/message-delivery-note';
import { BLANK_AUTOMATION, findAutomationPreset } from '@/components/automation/presets';
import { isTriggerWatched, TRIGGER_GROUPS } from '@/components/automation/watched-triggers';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardToolbar,
} from '@/components/ui/card';
import { FormAlert } from '@/components/ui/form-alert';
import { FormControl, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { SubmitButton } from '@/components/ui/submit-button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state';
import { actionTypeLabel, triggerTypeLabel } from '@/lib/labels';
import { createAutomationAction, updateAutomationAction } from '@/server/actions/automation.actions';
import { ACTION_TYPES } from '@/server/validation/automation';

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
  /** Preselects a ready-made rule from the templates on the list page. */
  templateId?: string;
}

/**
 * Every step type except "Assign the chat", which stores a team member's id. Naming a member
 * needs the workspace's member list, which this form is not given and which no lightweight
 * service exposes — so rather than offer a picker that can only take a UUID, the step is left out
 * of the menu. A rule that already has one keeps it: the step is listed, its settings travel with
 * the payload, and saving from here does not discard it.
 */
const ADDABLE_ACTION_TYPES = ACTION_TYPES.filter((type) => type !== 'ASSIGN_CONVERSATION');

export function AutomationForm({ initialData, templateId }: AutomationFormProps) {
  const isEditing = Boolean(initialData?.id);
  const initialValues: AutomationFormData =
    initialData ?? findAutomationPreset(templateId)?.values ?? BLANK_AUTOMATION;

  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description ?? '');
  const [isActive, setIsActive] = useState(initialValues.isActive);
  const [triggerType, setTriggerType] = useState(initialValues.triggerType);
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(
    initialValues.triggerConfig ?? {},
  );
  const [actions, setActions] = useState<ActionConfigItem[]>(initialValues.actions);

  // Ids only have to be unique within this list for React's sake; the server assigns the real
  // ones. A counter keeps them stable across re-renders, which a timestamp would not.
  const newStepCount = useRef(0);

  const actionFn = isEditing
    ? updateAutomationAction.bind(null, initialData?.id ?? '')
    : createAutomationAction;
  const [state, formAction] = useActionState<FormState, FormData>(actionFn, IDLE_FORM_STATE);

  const errorFor = (field: string) => state.fieldErrors?.[field]?.[0];

  function changeTrigger(next: string) {
    setTriggerType(next);
    setTriggerConfig(defaultTriggerConfig(next));
  }

  function addStep(type: string) {
    newStepCount.current += 1;
    setActions((current) => [
      ...current,
      { id: `new-step-${newStepCount.current}`, type, config: defaultActionConfig(type) },
    ]);
  }

  function moveStep(index: number, offset: -1 | 1) {
    setActions((current) => {
      const target = index + offset;
      const moving = current[index];
      const displaced = current[target];
      // A missing neighbour means the step is already at one end, so there is nothing to do.
      if (!moving || !displaced) return current;

      const next = [...current];
      next[index] = displaced;
      next[target] = moving;
      return next;
    });
  }

  function removeStep(index: number) {
    setActions((current) => current.filter((_, position) => position !== index));
  }

  function patchStepConfig(index: number, patch: Record<string, unknown>) {
    setActions((current) =>
      current.map((action, position) =>
        position === index ? { ...action, config: { ...action.config, ...patch } } : action,
      ),
    );
  }

  function replaceStepConfig(index: number, config: Record<string, unknown>) {
    setActions((current) =>
      current.map((action, position) => (position === index ? { ...action, config } : action)),
    );
  }

  const payloadJson = JSON.stringify({
    name,
    description: description.trim() ? description : null,
    isActive,
    triggerType,
    triggerConfig,
    actions: actions.map((action, index) => ({
      position: index,
      type: action.type,
      config: action.config,
    })),
  });

  // Reasons this rule could not do its job, stated plainly and checked before the server has to.
  const blockers: string[] = [];
  if (actions.length === 0) blockers.push('Add at least one step.');
  if (
    triggerType === 'MESSAGE_CONTAINS' &&
    (!Array.isArray(triggerConfig.keywords) || triggerConfig.keywords.length === 0)
  ) {
    blockers.push('Add at least one word for the rule to look for.');
  }
  actions.forEach((action, index) => {
    const blocker = stepBlocker(action, index + 1);
    if (blocker) blockers.push(blocker);
  });

  const triggerIsLive = isTriggerWatched(triggerType);
  const hasMessageStep = actions.some(
    (action) => action.type === 'SEND_MESSAGE' || action.type === 'SEND_TEMPLATE',
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={payloadJson} />

      <FormAlert state={state} />

      <Card>
        <CardHeader>
          <CardTitle>Name and status</CardTitle>
          <CardDescription>
            The name is for you and your team. Customers never see it.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <FormField error={errorFor('name')}>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Greet a new enquiry"
                maxLength={100}
                required
              />
            </FormControl>
          </FormField>

          <FormField error={errorFor('description')}>
            <FormLabel>What it is for, if it needs saying</FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Answers the first message so nobody waits, and tags the customer so we can follow up."
                maxLength={500}
              />
            </FormControl>
          </FormField>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="automation-active">Run this automation</Label>
              <p className="max-w-prose text-sm text-muted-foreground">
                Switched off, the rule stays saved and never starts. You can turn it on and off
                from the automations list at any time.
              </p>
            </div>
            <div className="shrink-0 pt-0.5">
              <Switch id="automation-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What starts it</CardTitle>
          <CardDescription>
            One event per rule. Everything below it runs each time that event happens.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <FormField error={errorFor('triggerType')}>
            <FormLabel>This rule starts when</FormLabel>
            <FormControl>
              <NativeSelect
                value={triggerType}
                onChange={(event) => changeTrigger(event.target.value)}
              >
                {TRIGGER_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.triggerTypes.map((type) => (
                      <option key={type} value={type}>
                        {triggerTypeLabel(type)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </FormControl>
          </FormField>

          {triggerIsLive ? null : (
            /* Announced politely: this appears the moment the trigger dropdown changes, and it
               is the one thing that would change the reader's choice. */
            <Alert variant="warning" live="polite">
              <AlertTriangle aria-hidden />
              <AlertTitle>Nothing raises this event yet</AlertTitle>
              <AlertDescription>
                This rule will save, but it will not run: nothing in the product announces when{' '}
                {triggerTypeLabel(triggerType)}. If you need it working today, pick one of the
                events listed under &ldquo;Ready to use&rdquo;.
              </AlertDescription>
            </Alert>
          )}

          <TriggerFields
            triggerType={triggerType}
            config={triggerConfig}
            onPatch={(patch) => setTriggerConfig((current) => ({ ...current, ...patch }))}
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardToolbar>
          <div className="flex flex-col gap-1">
            <CardTitle>What it does, in order</CardTitle>
            <CardDescription>
              Steps run top to bottom. A wait step pauses the rest until its time is up.
            </CardDescription>
          </div>

          <NativeSelect
            aria-label="Add a step"
            value=""
            onChange={(event) => {
              if (event.target.value) addStep(event.target.value);
            }}
            wrapperClassName="sm:w-64"
          >
            <option value="" disabled>
              Choose a step to add…
            </option>
            {ADDABLE_ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {actionTypeLabel(type)}
              </option>
            ))}
          </NativeSelect>
        </CardToolbar>

        {actions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 border-t border-border px-5 py-10 text-center">
            <ListPlus className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">No steps yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Choose a step above. Most rules start with a message or a tag, and a rule with no
              steps would start and then do nothing.
            </p>
          </div>
        ) : (
          <ol className="border-t border-border">
            {actions.map((action, index) => (
              <li
                key={action.id}
                className="flex flex-col gap-3 border-b border-border px-5 py-4 last:border-b-0"
              >
                <div className="flex items-start gap-3">
                  <span className="w-4 shrink-0 pt-0.5 font-mono text-sm tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 pt-px text-sm font-medium text-foreground">
                    {actionTypeLabel(action.type)}
                  </span>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => moveStep(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move step ${index + 1} earlier`}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => moveStep(index, 1)}
                      disabled={index === actions.length - 1}
                      aria-label={`Move step ${index + 1} later`}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeStep(index)}
                      className="hover:text-destructive"
                      aria-label={`Remove step ${index + 1}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-4 pl-7">
                  <StepFields
                    action={action}
                    onPatch={(patch) => patchStepConfig(index, patch)}
                    onReplace={(config) => replaceStepConfig(index, config)}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}

        {errorFor('actions') ? (
          <div className="border-t border-border px-5 py-3.5">
            <p className="text-sm font-medium text-destructive">{errorFor('actions')}</p>
          </div>
        ) : null}
      </Card>

      {hasMessageStep ? <MessageDeliveryNote /> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        {blockers.length > 0 ? (
          <div id="save-blockers" className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Before you can save</p>
            <ul className="flex max-w-prose flex-col gap-1">
              {blockers.map((blocker) => (
                <li key={blocker} className="text-sm text-muted-foreground">
                  {blocker}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <span />
        )}

        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/automations">Cancel</Link>
          </Button>
          <SubmitButton
            disabled={blockers.length > 0}
            aria-describedby={blockers.length > 0 ? 'save-blockers' : undefined}
            pendingText={isEditing ? 'Saving…' : 'Creating…'}
          >
            {isEditing ? 'Save changes' : 'Create automation'}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
