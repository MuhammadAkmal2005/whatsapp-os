'use client';

/**
 * The AI assistant configuration form.
 *
 * One `<form>` around every card and one explicit Save, rather than a save per section. The
 * settings are read together by the prompt builder on every reply — the job, the tone and the
 * instructions are one paragraph in the same system prompt — so saving them together is what
 * matches how they take effect. It also means a shop owner can change three things and press one
 * button, which is the ordinary expectation of a settings screen.
 *
 * The shell owns `useActionState`, the values every field renders from, and the on/off state; the
 * cards own their inputs. That split keeps every file in this folder short enough to read in one
 * sitting, and it is the same shape `edit-product-form` uses.
 *
 * `canUpdate` disables every control and removes the Save button. It is an affordance, not a
 * defence: `requirePermission(ctx, 'agent:update')` inside the service is what actually stops a
 * save, and it runs whether or not this component rendered a button.
 */

import { useActionState, useState } from 'react';

import { AgentBehaviourCard } from '@/components/agent/agent-behaviour-card';
import { AgentHandoverCard } from '@/components/agent/agent-handover-card';
import { AgentIdentityCard } from '@/components/agent/agent-identity-card';
import { AgentRepliesCard } from '@/components/agent/agent-replies-card';
import { AgentStatusCard } from '@/components/agent/agent-status-card';
import { FormAlert } from '@/components/ui/form-alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { updateAgentConfigAction, type AgentFormState } from '@/server/actions/agent.actions';
import type { AgentConfigView } from '@/server/services/agent/agent-config.service';
import {
  formatHandoffKeywordList,
  isAgentRole,
  isAgentTone,
} from '@/server/validation/agent';

export function AgentConfigForm({
  agent,
  canUpdate,
}: {
  agent: AgentConfigView;
  canUpdate: boolean;
}) {
  const [state, formAction] = useActionState<AgentFormState, FormData>(
    updateAgentConfigAction,
    IDLE_FORM_STATE,
  );

  // Only ever set by the owner clicking the switch, and only meaningful until the next save.
  // Null means "they have not touched it", so the control shows the stored value.
  const [pendingIsActive, setPendingIsActive] = useState<boolean | null>(null);

  // What every field renders from. Before the first save that is the stored row; afterwards it is
  // whatever the action said to show — the saved row, or the owner's own rejected input. React
  // resets this form when the action settles, restoring each field to the `defaultValue` of the
  // render it settles into, so this is the value the owner is left with either way. See
  // `AgentFormState` for why the `agent` prop cannot play that part.
  const posted = state.values;

  const values = {
    name: posted?.name ?? agent.name,
    // A picker can only post its own options, so a string that is not one of them came from
    // somewhere other than this screen and the stored value is the honest thing to show.
    role: posted && isAgentRole(posted.role) ? posted.role : agent.role,
    tone: posted && isAgentTone(posted.tone) ? posted.tone : agent.tone,
    persona: posted?.persona ?? agent.persona ?? '',
    greeting: posted?.greeting ?? agent.greeting ?? '',
    customInstructions: posted?.customInstructions ?? agent.customInstructions ?? '',
    handoffKeywords: posted?.handoffKeywords ?? formatHandoffKeywordList(agent.handoffKeywords),
    temperature: posted?.temperature ?? String(agent.temperature),
    maxOutputTokens: posted?.maxOutputTokens ?? String(agent.maxOutputTokens),
    isActive: posted?.isActive ?? agent.isActive,
  };

  const isActive = pendingIsActive ?? values.isActive;

  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  const disabled = !canUpdate;

  // What the database holds, which is not always what the switch shows. A refused save wrote
  // nothing, so the row is still the prop even though the switch is the owner's unsaved choice.
  const storedIsActive = state.status === 'success' ? values.isActive : agent.isActive;

  // The one change on this screen whose effect is invisible from this screen, so it is spelled
  // out next to the button that would commit it.
  const willStopReplying = storedIsActive && !isActive;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-6"
      noValidate
      // React resets this form once the action settles, which is how every text field picks up the
      // values the action echoed back. A reset means "show the defaults", so the switch drops the
      // owner's unsaved choice here and renders from those same values. On a microtask because
      // Radix's own reset handling is deferred, and this has to be the write that lands last.
      onReset={() => queueMicrotask(() => setPendingIsActive(null))}
    >
      <FormAlert state={state} successTitle="Assistant updated" />

      <AgentIdentityCard
        name={values.name}
        role={values.role}
        tone={values.tone}
        persona={values.persona}
        fieldErrors={fieldErrors}
        disabled={disabled}
      />

      <AgentRepliesCard
        greeting={values.greeting}
        customInstructions={values.customInstructions}
        fieldErrors={fieldErrors}
        disabled={disabled}
      />

      {/*
        Remounted on every accepted save, because normalising keywords is visible work: `Manager`
        and `MANAGER` are stored as the one keyword `manager`, and a textarea keeps whatever was
        typed into it across a re-render — React syncs a changed default into an `<input>` but not
        into a `<textarea>`. Keyed on the save counter rather than on the list, since the case worth
        fixing is exactly the one where the stored list did not change and a value-derived key would
        not move. A refused save leaves the counter alone, so unsaved work is never remounted away.
      */}
      <AgentHandoverCard
        key={`saved-${state.savedSerial ?? 0}`}
        keywords={values.handoffKeywords}
        fieldErrors={fieldErrors}
        disabled={disabled}
      />

      <AgentBehaviourCard
        temperature={values.temperature}
        maxOutputTokens={values.maxOutputTokens}
        model={agent.model}
        providerIsMock={agent.providerIsMock}
        fieldErrors={fieldErrors}
        disabled={disabled}
      />

      <AgentStatusCard
        isActive={isActive}
        onToggle={() => setPendingIsActive(!isActive)}
        disabled={disabled}
      />

      {canUpdate ? (
        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {willStopReplying
              ? 'Saving now will stop your assistant replying to customers.'
              : 'Changes take effect on the next customer message.'}
          </p>
          <SubmitButton pendingText="Saving…" className="sm:w-auto">
            Save changes
          </SubmitButton>
        </div>
      ) : (
        <p className="border-t border-border pt-5 text-sm text-muted-foreground">
          You can see how your assistant is set up, but not change it. An owner, admin or manager
          on your team can update these settings.
        </p>
      )}
    </form>
  );
}
