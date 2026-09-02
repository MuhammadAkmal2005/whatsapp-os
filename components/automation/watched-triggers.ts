/**
 * Which starting events the product actually watches for today.
 *
 * Thirteen trigger types are defined and stored, and the engine has a matcher for most of them,
 * but only four are ever dispatched. Every call to `triggerAutomations` lives in one of these
 * places:
 *
 *   server/services/whatsapp/webhook-processor.service.ts  →  MESSAGE_RECEIVED, MESSAGE_CONTAINS
 *   server/services/automation/conversation-idle.service.ts →  CONVERSATION_IDLE
 *   server/services/agent/handoff.service.ts                →  HANDOFF_REQUESTED
 *
 * (Two further call sites are not new events: the manual test action re-fires whatever the rule
 * already listens for, and the job handler resumes a run that a wait step paused.)
 *
 * Nothing in the order, contact, payment, product or appointment services raises a trigger, so a
 * rule built on the other nine events saves correctly and then never runs. The builder says so
 * rather than offering rules that quietly do nothing.
 *
 * This list is a statement about the backend held in the UI layer, which means it can drift: if
 * you add a `triggerAutomations` call for a new event, add its type here too.
 */

import { TRIGGER_TYPES, type TriggerType } from '@/server/validation/automation';

const WATCHED: readonly TriggerType[] = [
  'MESSAGE_RECEIVED',
  'MESSAGE_CONTAINS',
  'CONVERSATION_IDLE',
  'HANDOFF_REQUESTED',
];

const WATCHED_SET: ReadonlySet<string> = new Set<string>(WATCHED);

/** True when something in the product raises this event, so a rule starting here can run. */
export function isTriggerWatched(triggerType: string): boolean {
  return WATCHED_SET.has(triggerType);
}

export type TriggerGroup = {
  label: string;
  triggerTypes: readonly TriggerType[];
};

/**
 * The trigger list split for a picker, in the order the validation schema declares them so the
 * builder and the schema never disagree about what exists.
 *
 * The dormant group is offered rather than hidden: rules already exist on those events — two of
 * the ready-made templates build them — and someone whose rule has never run needs to be able to
 * open it and find out why.
 */
export const TRIGGER_GROUPS: readonly TriggerGroup[] = [
  {
    label: 'Ready to use',
    triggerTypes: TRIGGER_TYPES.filter((type) => WATCHED_SET.has(type)),
  },
  {
    label: 'Not watched yet — a rule starting here will not run',
    triggerTypes: TRIGGER_TYPES.filter((type) => !WATCHED_SET.has(type)),
  },
];
