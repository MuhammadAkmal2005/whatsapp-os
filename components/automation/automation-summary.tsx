/**
 * A rule, stated in words rather than in form fields.
 *
 * Shown to someone who is allowed to read automations but not change them. The alternative
 * was the builder with everything disabled, which is a screen full of controls that look like
 * they work and a Save button that would be refused by the server — so instead the same facts
 * are written out plainly.
 *
 * Every detail line comes from the stored config and is read defensively: the config is JSON,
 * so a field can be missing or the wrong shape, and a missing detail simply goes unmentioned
 * rather than rendering "undefined" beside a step.
 */

import { AlertTriangle } from 'lucide-react';

import { isTriggerWatched } from '@/components/automation/watched-triggers';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { actionTypeLabel, handoffReasonLabel, humaniseCode, triggerTypeLabel } from '@/lib/labels';

type ActionSummary = {
  id: string;
  type: string;
  config: Record<string, unknown>;
};

export interface AutomationSummaryProps {
  triggerType: string;
  triggerConfig: Record<string, unknown> | null;
  actions: ActionSummary[];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** A gap in plain language, from seconds up to days. */
function durationLabel(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds} ${totalSeconds === 1 ? 'second' : 'seconds'}`;
  }

  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;

  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Number.isInteger(hours) ? hours : Number(hours.toFixed(1));
    return `${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
  }

  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** What the trigger is watching for, where the config says something worth reading. */
function describeTrigger(
  triggerType: string,
  config: Record<string, unknown> | null,
): string | null {
  if (!config) return null;

  switch (triggerType) {
    case 'MESSAGE_CONTAINS': {
      const keywords = list(config.keywords);
      if (keywords.length === 0) return null;
      const mode = text(config.matchMode);
      const joined = keywords.join(', ');
      if (mode === 'ALL') return `Only when the message has all of: ${joined}`;
      if (mode === 'EXACT') return `Only when the message is exactly: ${joined}`;
      return `Any of: ${joined}`;
    }
    case 'CONVERSATION_IDLE': {
      const minutes = count(config.idleMinutes);
      return minutes === null ? null : `After ${durationLabel(minutes * 60)} with no reply`;
    }
    case 'ORDER_STATUS_CHANGED': {
      const from = text(config.fromStatus);
      const to = text(config.toStatus);
      if (from && to) return `From ${humaniseCode(from)} to ${humaniseCode(to)}`;
      if (to) return `Whenever it becomes ${humaniseCode(to)}`;
      if (from) return `Whenever it leaves ${humaniseCode(from)}`;
      return null;
    }
    case 'LEAD_STAGE_CHANGED': {
      const to = text(config.toStage);
      return to ? `Whenever the lead reaches ${humaniseCode(to)}` : null;
    }
    case 'LOW_STOCK': {
      const threshold = count(config.threshold);
      return threshold === null ? null : `When ${threshold} or fewer are left`;
    }
    default:
      return null;
  }
}

/** The one fact about a step worth reading beside its name. */
function describeAction(action: ActionSummary): string | null {
  const config = action.config;

  switch (action.type) {
    case 'SEND_MESSAGE': {
      const body = text(config.body);
      return body ? `“${body}”` : null;
    }
    case 'SEND_TEMPLATE': {
      const name = text(config.templateName);
      return name ? `Template: ${name}` : null;
    }
    case 'WAIT': {
      const seconds = count(config.durationSeconds);
      const minutes = count(config.durationMinutes);
      const total = seconds ?? (minutes === null ? null : minutes * 60);
      return total === null ? null : durationLabel(total);
    }
    case 'ADD_TAG':
    case 'REMOVE_TAG': {
      const tags = list(config.tags);
      return tags.length === 0 ? null : tags.join(', ');
    }
    case 'SET_CONVERSATION_STATUS': {
      const status = text(config.status);
      return status ? humaniseCode(status) : null;
    }
    case 'SET_PRIORITY': {
      const priority = text(config.priority);
      return priority ? humaniseCode(priority) : null;
    }
    case 'SET_LEAD_STAGE': {
      const stage = text(config.stage);
      return stage ? humaniseCode(stage) : null;
    }
    case 'PAUSE_AI': {
      const reason = text(config.reason);
      return reason ? `Reason given to your team: ${handoffReasonLabel(reason)}` : null;
    }
    case 'NOTIFY_TEAM': {
      const title = text(config.title);
      return title ? `“${title}”` : null;
    }
    case 'CREATE_NOTE': {
      const content = text(config.content);
      return content ? `“${content}”` : null;
    }
    default:
      // ASSIGN_CONVERSATION stores a member id, which would need a lookup to name. Better
      // unmentioned than shown as a UUID.
      return null;
  }
}

export function AutomationSummary({ triggerType, triggerConfig, actions }: AutomationSummaryProps) {
  const triggerDetail = describeTrigger(triggerType, triggerConfig);

  return (
    <Card>
      <CardHeader>
        <CardTitle>How this rule works</CardTitle>
        <CardDescription>
          You can see how this automation is set up. Changing it is up to an owner, admin or
          manager.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-1">
          <h3 className="eyebrow">What starts it</h3>
          <p className="text-sm text-foreground">When {triggerTypeLabel(triggerType)}</p>
          {triggerDetail ? (
            <p className="max-w-prose text-sm text-muted-foreground">{triggerDetail}</p>
          ) : null}

          {isTriggerWatched(triggerType) ? null : (
            <Alert variant="warning" className="mt-2">
              <AlertTriangle aria-hidden />
              <AlertTitle>Nothing raises this event yet</AlertTitle>
              <AlertDescription>
                The rule is set up correctly, but nothing in the product announces when{' '}
                {triggerTypeLabel(triggerType)} — so it has not been running. An owner, admin or
                manager can point it at an event that is ready to use.
              </AlertDescription>
            </Alert>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="eyebrow">What it does, in order</h3>

          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No steps yet, so this rule does nothing when it starts.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {actions.map((action, index) => {
                const detail = describeAction(action);

                return (
                  <li key={action.id} className="flex gap-3">
                    <span className="w-4 shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm text-foreground">{actionTypeLabel(action.type)}</span>
                      {detail ? (
                        <span className="max-w-prose break-words text-sm text-muted-foreground">
                          {detail}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
