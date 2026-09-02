'use client';

/**
 * The settings that belong to a rule's starting event.
 *
 * Each event gets only the fields it actually uses, read from the engine rather than from the
 * config schemas — the per-trigger schemas exist but nothing imports them, so the engine's
 * reader is the only reliable statement of which keys matter.
 *
 * Where a "from" or "to" value is left as Any, the engine treats it as a wildcard, so both sides
 * offer Any rather than forcing a choice the rule does not need.
 */

import {
  CommaListInput,
  listValue,
  NumberInput,
  numberValue,
  textValue,
} from '@/components/automation/automation-config-inputs';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { LEAD_STAGE_LABELS, LEAD_STAGES } from '@/server/validation/contact';
import { ORDER_STATUS_LABELS, ORDER_STATUSES } from '@/server/validation/order';

/**
 * Mirrors the match modes in `messageContainsConfigSchema`. The schema keeps the codes; a picker
 * needs the sentence, and there is no shared label table for these three.
 */
const MATCH_MODES = [
  { value: 'ANY', label: 'Any one of these words appears' },
  { value: 'ALL', label: 'All of these words appear' },
  { value: 'EXACT', label: 'The message is exactly one of these' },
] as const;

/** How long a chat may sit quiet before a rule may start: one minute up to a week. */
const IDLE_MINUTES = { min: 1, max: 10080, fallback: 60 } as const;

/** The stock level a low-stock rule watches. Zero is meaningful: only when it sells out. */
const STOCK_THRESHOLD = { min: 0, max: 10000, fallback: 5 } as const;

/**
 * A fresh set of settings for a newly chosen event.
 *
 * Switching event replaces the settings rather than keeping them, because a `keywords` list means
 * nothing to an idle timer and a stale key would travel with the rule for the rest of its life.
 */
export function defaultTriggerConfig(triggerType: string): Record<string, unknown> {
  switch (triggerType) {
    case 'MESSAGE_CONTAINS':
      return { keywords: [], matchMode: 'ANY', caseSensitive: false };
    case 'CONVERSATION_IDLE':
      return { idleMinutes: IDLE_MINUTES.fallback };
    case 'LOW_STOCK':
      return { threshold: STOCK_THRESHOLD.fallback };
    case 'ORDER_STATUS_CHANGED':
      return { fromStatus: null, toStatus: null };
    case 'LEAD_STAGE_CHANGED':
      return { fromStage: null, toStage: null };
    default:
      return {};
  }
}

/** Empty string is the Any option in a picker; the engine reads a missing value as a wildcard. */
function orNull(raw: string): string | null {
  return raw.length > 0 ? raw : null;
}

export interface TriggerFieldsProps {
  triggerType: string;
  config: Record<string, unknown>;
  /** Merges into the stored settings. */
  onPatch: (patch: Record<string, unknown>) => void;
}

export function TriggerFields({ triggerType, config, onPatch }: TriggerFieldsProps) {
  switch (triggerType) {
    case 'MESSAGE_CONTAINS': {
      const keywords = listValue(config.keywords);
      const matchMode = textValue(config.matchMode) ?? 'ANY';
      const caseSensitive = config.caseSensitive === true;

      return (
        <>
          <FormField>
            <FormLabel>Words to look for</FormLabel>
            <FormControl>
              <CommaListInput
                value={keywords}
                onValueChange={(next) => onPatch({ keywords: next })}
                placeholder="price, delivery, size"
              />
            </FormControl>
            <FormDescription>
              Separate each one with a comma. Add the Roman Urdu your customers actually type —
              rate, kitna, available — alongside the English.
            </FormDescription>
          </FormField>

          <FormField>
            <FormLabel>How closely it has to match</FormLabel>
            <FormControl>
              <NativeSelect
                value={matchMode}
                onChange={(event) => onPatch({ matchMode: event.target.value })}
              >
                {MATCH_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          </FormField>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="trigger-case-sensitive">Match capital letters exactly</Label>
              <p className="max-w-prose text-sm text-muted-foreground">
                Leave this off unless capitals matter. Off, a message saying Price, price or PRICE
                all count.
              </p>
            </div>
            <div className="shrink-0 pt-0.5">
              <Switch
                id="trigger-case-sensitive"
                checked={caseSensitive}
                onCheckedChange={(checked) => onPatch({ caseSensitive: checked })}
              />
            </div>
          </div>
        </>
      );
    }

    case 'CONVERSATION_IDLE': {
      const idleMinutes = numberValue(config.idleMinutes) ?? IDLE_MINUTES.fallback;

      return (
        <FormField>
          <FormLabel>Quiet for how long, in minutes</FormLabel>
          <FormControl>
            <NumberInput
              value={idleMinutes}
              min={IDLE_MINUTES.min}
              max={IDLE_MINUTES.max}
              onValueChange={(next) => onPatch({ idleMinutes: next })}
              className="sm:max-w-form"
            />
          </FormControl>
          <FormDescription>
            Counted from the last message in the chat. 60 is an hour, 1440 is a day, and a week is
            the longest this can wait.
          </FormDescription>
        </FormField>
      );
    }

    case 'LOW_STOCK': {
      const threshold = numberValue(config.threshold) ?? STOCK_THRESHOLD.fallback;

      return (
        <FormField>
          <FormLabel>Start when this many are left</FormLabel>
          <FormControl>
            <NumberInput
              value={threshold}
              min={STOCK_THRESHOLD.min}
              max={STOCK_THRESHOLD.max}
              onValueChange={(next) => onPatch({ threshold: next })}
              className="sm:max-w-form"
            />
          </FormControl>
          <FormDescription>
            Counted in units still available to sell. Set 0 to wait until a product sells out.
          </FormDescription>
        </FormField>
      );
    }

    case 'ORDER_STATUS_CHANGED': {
      const fromStatus = textValue(config.fromStatus) ?? '';
      const toStatus = textValue(config.toStatus) ?? '';

      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField>
            <FormLabel>Changing from</FormLabel>
            <FormControl>
              <NativeSelect
                value={fromStatus}
                onChange={(event) => onPatch({ fromStatus: orNull(event.target.value) })}
              >
                <option value="">Any status</option>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {ORDER_STATUS_LABELS[status]}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          </FormField>

          <FormField>
            <FormLabel>Changing to</FormLabel>
            <FormControl>
              <NativeSelect
                value={toStatus}
                onChange={(event) => onPatch({ toStatus: orNull(event.target.value) })}
              >
                <option value="">Any status</option>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {ORDER_STATUS_LABELS[status]}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          </FormField>
        </div>
      );
    }

    case 'LEAD_STAGE_CHANGED': {
      const fromStage = textValue(config.fromStage) ?? '';
      const toStage = textValue(config.toStage) ?? '';

      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField>
            <FormLabel>Moving from</FormLabel>
            <FormControl>
              <NativeSelect
                value={fromStage}
                onChange={(event) => onPatch({ fromStage: orNull(event.target.value) })}
              >
                <option value="">Any stage</option>
                {LEAD_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {LEAD_STAGE_LABELS[stage]}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          </FormField>

          <FormField>
            <FormLabel>Moving to</FormLabel>
            <FormControl>
              <NativeSelect
                value={toStage}
                onChange={(event) => onPatch({ toStage: orNull(event.target.value) })}
              >
                <option value="">Any stage</option>
                {LEAD_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {LEAD_STAGE_LABELS[stage]}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
          </FormField>
        </div>
      );
    }

    case 'MESSAGE_RECEIVED':
      return (
        <p className="max-w-prose text-sm text-muted-foreground">
          Every message a customer sends starts this rule, whatever it says. There is nothing to
          set up.
        </p>
      );

    case 'HANDOFF_REQUESTED':
      return (
        <p className="max-w-prose text-sm text-muted-foreground">
          Starts as soon as a chat is handed to your team — whether the AI escalated it or someone
          took over. There is nothing to set up.
        </p>
      );

    default:
      // Every remaining event is one nothing raises yet, and the notice above the fields already
      // says so. A second sentence here would only repeat it.
      return null;
  }
}
