'use client';

/**
 * The settings that belong to one step of a rule.
 *
 * Every choice here is driven by the shared validation lists and label tables rather than typed
 * out, which is not only tidier: the previous version of this builder offered a MEDIUM priority,
 * a CUSTOMER_REQUEST handoff reason and a CRITICAL alert level, none of which the database
 * accepts. Because a step's config is stored as loose JSON, all three saved without complaint and
 * then failed at the moment the rule ran, in front of the customer rather than the shop owner.
 *
 * `stepBlocker` is the other half of that: a step whose one required field is empty is a step
 * that will run and do nothing, so the form refuses to save it and says which step and why.
 */

import {
  CommaListInput,
  listValue,
  NumberInput,
  numberValue,
  textValue,
} from '@/components/automation/automation-config-inputs';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { actionTypeLabel, handoffReasonLabel, humaniseCode } from '@/lib/labels';
import { LEAD_STAGE_LABELS, LEAD_STAGES } from '@/server/validation/contact';
import {
  CONVERSATION_STATUSES,
  HANDOFF_REASONS,
  PRIORITIES,
} from '@/server/validation/conversation';

/** A wait may be a minute or a week, the same span the idle trigger allows. */
const WAIT_MINUTES = { min: 1, max: 10080, fallback: 10 } as const;

/**
 * The alert levels a team notification may carry.
 *
 * Restricted on purpose to three of the four the database defines: SUCCESS exists for order and
 * payment notices, and an automation raising a "success" alert to the team reads as a mistake.
 * The codes are written out here because there is no shared label table for them, and because the
 * one schema that mentions them is never imported and lists a CRITICAL the database would reject.
 */
const ALERT_LEVELS = [
  { value: 'INFO', label: 'For information' },
  { value: 'WARNING', label: 'Needs attention' },
  { value: 'ERROR', label: 'Something is wrong' },
] as const;

/** A newly added step, ready to be filled in rather than pre-filled with something to delete. */
export function defaultActionConfig(actionType: string): Record<string, unknown> {
  switch (actionType) {
    case 'SEND_MESSAGE':
      return { body: '' };
    case 'SEND_TEMPLATE':
      return { templateName: '' };
    case 'WAIT':
      return { durationMinutes: WAIT_MINUTES.fallback };
    case 'ADD_TAG':
    case 'REMOVE_TAG':
      return { tags: [] };
    case 'SET_CONVERSATION_STATUS':
      return { status: 'OPEN' };
    case 'SET_PRIORITY':
      return { priority: 'HIGH' };
    case 'SET_LEAD_STAGE':
      return { stage: 'QUALIFIED' };
    case 'PAUSE_AI':
      return { reason: 'MANUAL_TAKEOVER' };
    case 'NOTIFY_TEAM':
      return { title: '', body: '', level: 'INFO' };
    case 'CREATE_NOTE':
      return { content: '' };
    default:
      return {};
  }
}

/**
 * Why this step cannot be saved yet, in a sentence the form can show verbatim, or null when it
 * is ready. Only the fields the engine actually needs are checked.
 */
export function stepBlocker(
  action: { type: string; config: Record<string, unknown> },
  stepNumber: number,
): string | null {
  const name = `Step ${stepNumber}, ${actionTypeLabel(action.type).toLowerCase()},`;

  switch (action.type) {
    case 'SEND_MESSAGE':
      return textValue(action.config.body) ? null : `${name} needs the words you want sent.`;
    case 'SEND_TEMPLATE':
      return textValue(action.config.templateName)
        ? null
        : `${name} needs the name of an approved template.`;
    case 'ADD_TAG':
    case 'REMOVE_TAG':
      return listValue(action.config.tags).length > 0 ? null : `${name} needs at least one tag.`;
    case 'NOTIFY_TEAM':
      return textValue(action.config.title) ? null : `${name} needs a heading for the alert.`;
    case 'CREATE_NOTE':
      return textValue(action.config.content) ? null : `${name} needs the note itself.`;
    default:
      return null;
  }
}

export interface StepFieldsProps {
  action: { type: string; config: Record<string, unknown> };
  /** Merges into this step's settings. */
  onPatch: (patch: Record<string, unknown>) => void;
  /** Replaces this step's settings outright. */
  onReplace: (config: Record<string, unknown>) => void;
}

export function StepFields({ action, onPatch, onReplace }: StepFieldsProps) {
  const config = action.config;

  switch (action.type) {
    case 'SEND_MESSAGE':
      return (
        <FormField>
          <FormLabel>What to send</FormLabel>
          <FormControl>
            <Textarea
              rows={3}
              value={typeof config.body === 'string' ? config.body : ''}
              onChange={(event) => onPatch({ body: event.target.value })}
              placeholder="Assalamualaikum! Thanks for your message — we'll confirm the details shortly."
            />
          </FormControl>
        </FormField>
      );

    case 'SEND_TEMPLATE':
      return (
        <FormField>
          <FormLabel>Template name</FormLabel>
          <FormControl>
            <Input
              value={typeof config.templateName === 'string' ? config.templateName : ''}
              onChange={(event) => onPatch({ templateName: event.target.value })}
              placeholder="order_update"
            />
          </FormControl>
          <FormDescription>
            The exact name of a template Meta has already approved for your number. A name that
            does not match an approved template will not send.
          </FormDescription>
        </FormField>
      );

    case 'WAIT': {
      const storedSeconds = numberValue(config.durationSeconds);
      const storedMinutes = numberValue(config.durationMinutes);

      // The engine prefers durationSeconds wherever it is present, so the box has to show
      // whichever value actually governs the wait. Writing a whole replacement config on change
      // then drops the seconds, rather than leaving a stored value that silently outranks the
      // number on screen.
      const effectiveMinutes =
        storedSeconds !== null ? storedSeconds / 60 : (storedMinutes ?? WAIT_MINUTES.fallback);
      const wholeMinutes = Math.max(WAIT_MINUTES.min, Math.round(effectiveMinutes));
      const isOddSeconds = storedSeconds !== null && !Number.isInteger(storedSeconds / 60);

      return (
        <FormField>
          <FormLabel>How long to wait, in minutes</FormLabel>
          <FormControl>
            <NumberInput
              value={wholeMinutes}
              min={WAIT_MINUTES.min}
              max={WAIT_MINUTES.max}
              onValueChange={(next) => onReplace({ durationMinutes: next })}
              className="sm:max-w-form"
            />
          </FormControl>
          <FormDescription>
            {isOddSeconds
              ? `Set to ${storedSeconds} seconds at the moment. Type a new number to replace it with whole minutes.`
              : 'The rule pauses here and picks up the next step when the time is up. 1440 is a day.'}
          </FormDescription>
        </FormField>
      );
    }

    case 'ADD_TAG':
    case 'REMOVE_TAG': {
      const isAdding = action.type === 'ADD_TAG';

      return (
        <FormField>
          <FormLabel>{isAdding ? 'Tags to add' : 'Tags to remove'}</FormLabel>
          <FormControl>
            <CommaListInput
              value={listValue(config.tags)}
              onValueChange={(next) => onPatch({ tags: next })}
              placeholder="new-enquiry, follow-up"
            />
          </FormControl>
          <FormDescription>
            Separate each one with a comma. Tags go on the customer, so you can find everyone this
            rule has touched from your customer list.
          </FormDescription>
        </FormField>
      );
    }

    case 'SET_CONVERSATION_STATUS':
      return (
        <FormField>
          <FormLabel>Change the chat to</FormLabel>
          <FormControl>
            <NativeSelect
              value={textValue(config.status) ?? 'OPEN'}
              onChange={(event) => onPatch({ status: event.target.value })}
              wrapperClassName="sm:max-w-form"
            >
              {CONVERSATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humaniseCode(status)}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        </FormField>
      );

    case 'SET_PRIORITY':
      return (
        <FormField>
          <FormLabel>Set the priority to</FormLabel>
          <FormControl>
            <NativeSelect
              value={textValue(config.priority) ?? 'HIGH'}
              onChange={(event) => onPatch({ priority: event.target.value })}
              wrapperClassName="sm:max-w-form"
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {humaniseCode(priority)}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        </FormField>
      );

    case 'SET_LEAD_STAGE':
      return (
        <FormField>
          <FormLabel>Move the lead to</FormLabel>
          <FormControl>
            <NativeSelect
              value={textValue(config.stage) ?? 'QUALIFIED'}
              onChange={(event) => onPatch({ stage: event.target.value })}
              wrapperClassName="sm:max-w-form"
            >
              {LEAD_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {LEAD_STAGE_LABELS[stage]}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
        </FormField>
      );

    case 'PAUSE_AI':
      return (
        <FormField>
          <FormLabel>Reason to show your team</FormLabel>
          <FormControl>
            <NativeSelect
              value={textValue(config.reason) ?? 'MANUAL_TAKEOVER'}
              onChange={(event) => onPatch({ reason: event.target.value })}
            >
              {HANDOFF_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {handoffReasonLabel(reason)}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
          <FormDescription>
            The AI stops replying in that chat and this reason appears beside it in your inbox.
            Someone on your team resumes the AI when they are done.
          </FormDescription>
        </FormField>
      );

    case 'RESUME_AI':
      return (
        <p className="max-w-prose text-sm text-muted-foreground">
          The AI starts replying in that chat again. There is nothing to set up.
        </p>
      );

    case 'NOTIFY_TEAM':
      return (
        <>
          <FormField>
            <FormLabel>Heading</FormLabel>
            <FormControl>
              <Input
                value={typeof config.title === 'string' ? config.title : ''}
                onChange={(event) => onPatch({ title: event.target.value })}
                placeholder="A lead is waiting on a reply"
              />
            </FormControl>
          </FormField>

          <FormField>
            <FormLabel>Detail, if it helps</FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                value={typeof config.body === 'string' ? config.body : ''}
                onChange={(event) => onPatch({ body: event.target.value })}
                placeholder="Qualified in the last hour and has not heard back."
              />
            </FormControl>
            <FormDescription>
              Optional. Both the heading and this appear in your team&apos;s notifications, next to
              a link to whatever the rule was acting on.
            </FormDescription>
          </FormField>

          <FormField>
            <FormLabel>How urgent it is</FormLabel>
            <FormControl>
              <NativeSelect
                value={textValue(config.level) ?? 'INFO'}
                onChange={(event) => onPatch({ level: event.target.value })}
                wrapperClassName="sm:max-w-form"
              >
                {ALERT_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          </FormField>
        </>
      );

    case 'CREATE_NOTE':
      return (
        <FormField>
          <FormLabel>The note</FormLabel>
          <FormControl>
            <Textarea
              rows={2}
              value={typeof config.content === 'string' ? config.content : ''}
              onChange={(event) => onPatch({ content: event.target.value })}
              placeholder="Asked about bulk pricing for 20+ pieces."
            />
          </FormControl>
          <FormDescription>
            Kept for your team as a record of what the rule did. It is not shown to the customer.
          </FormDescription>
        </FormField>
      );

    default:
      // A step type this builder has no fields for — today that is only "Assign the chat", which
      // stores a team member's id and would need a lookup to name. Its settings travel with the
      // rule untouched, so saving from here cannot quietly discard it.
      return (
        <p className="max-w-prose text-sm text-muted-foreground">
          This step has no settings you can change here. It is kept exactly as it is when you save.
        </p>
      );
  }
}
