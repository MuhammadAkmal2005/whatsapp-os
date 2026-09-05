'use server';

/**
 * AI assistant configuration server actions.
 *
 * Thin adapters: parse the form, delegate, translate the outcome. Neither of these checks a
 * permission — `requirePermission` runs inside `agent-config.service`, which is the one place
 * the screen and any future API route both pass through.
 *
 * Note what is absent from the parsed object: an agent id. The product manages one assistant
 * per workspace, so the service resolves the row from the tenant context and a crafted form
 * post has no field with which to name a different one.
 */

import { revalidatePath } from 'next/cache';

import { type FormState } from '@/lib/form-state';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import {
  provisionAgentConfig,
  updateAgentConfiguration,
  type AgentConfigView,
} from '@/server/services/agent/agent-config.service';
import { requireTenantContext } from '@/server/tenancy/resolve';
import { formatHandoffKeywordList, updateAgentConfigSchema } from '@/server/validation/agent';

const AGENT_PATH = '/agent';

/**
 * What the configuration form gets back, alongside the outcome.
 *
 * React resets a `<form action={…}>` once the action settles, and a reset restores every
 * uncontrolled field to the `defaultValue` of that render — so whatever the form renders from at
 * that moment is what the owner is left looking at. Rendering from the `agent` prop is not good
 * enough for either outcome. On a rejected save the prop still holds the stored row, so the reset
 * would erase the paragraph the owner just typed and hand back the values they were trying to
 * change — a screen that asks them to fix one field by deleting all their work. On an accepted
 * save the prop is a revalidated read that is not dependable the instant the write lands, and the
 * assistant's on/off switch was observed showing the pre-save value while the badge two inches
 * above it showed the new one; that switch feeds a hidden input, so the *next* save would post the
 * stale value and pause an assistant nobody asked to pause.
 *
 * So the action says what to render: the submitted values when a save was refused, and the saved
 * row when it succeeded. `useActionState` hands this straight to the component with no cache in
 * between, which is why it can be trusted where the prop could not — and echoing the saved row
 * also means normalisation is visible, so an owner who typed `Manager, MANAGER` sees the one
 * keyword that was actually stored.
 */
export type AgentFormValues = {
  name: string;
  role: string;
  tone: string;
  persona: string;
  greeting: string;
  customInstructions: string;
  handoffKeywords: string;
  temperature: string;
  maxOutputTokens: string;
  isActive: boolean;
};

/**
 * `savedSerial` counts accepted saves, and it exists because one field's normalisation is not
 * visible without it.
 *
 * React syncs a changed `defaultValue` into an `<input>` but not into a `<textarea>`, so the
 * handover keywords box keeps whatever was typed into it even after the action echoes the stored
 * list back. Remounting that card fixes it, and a remount needs a key that changes — which the
 * list itself cannot supply, because the interesting case is exactly the one where `Manager,
 * MANAGER` and `manager` are the same stored list and the key would not move. A counter does
 * change, on every accepted save and only then: a refused save leaves it alone, so the owner's
 * unsaved work is never remounted out from under them.
 */
export type AgentFormState = FormState & { values?: AgentFormValues; savedSerial?: number };

/** A posted field as the owner left it. Absent and empty are the same thing to a text input. */
function postedText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value : '';
}

/**
 * What the owner posted, echoed back verbatim so a refused save costs them nothing.
 *
 * Deliberately unvalidated and untransformed: this never reaches the database, it only goes back
 * into the same inputs it came from. `isActive` is the one exception, because the switch reads a
 * boolean — and it is compared against `'true'` rather than coerced, since every non-empty string
 * is truthy and `'false'` would come back as on.
 */
function postedValues(formData: FormData): AgentFormValues {
  return {
    name: postedText(formData, 'name'),
    role: postedText(formData, 'role'),
    tone: postedText(formData, 'tone'),
    persona: postedText(formData, 'persona'),
    greeting: postedText(formData, 'greeting'),
    customInstructions: postedText(formData, 'customInstructions'),
    handoffKeywords: postedText(formData, 'handoffKeywords'),
    temperature: postedText(formData, 'temperature'),
    maxOutputTokens: postedText(formData, 'maxOutputTokens'),
    isActive: formData.get('isActive') === 'true',
  };
}

/** What the database now holds, in the shape the form's inputs take. */
function savedValues(agent: AgentConfigView): AgentFormValues {
  return {
    name: agent.name,
    role: agent.role,
    tone: agent.tone,
    persona: agent.persona ?? '',
    greeting: agent.greeting ?? '',
    customInstructions: agent.customInstructions ?? '',
    handoffKeywords: formatHandoffKeywordList(agent.handoffKeywords),
    temperature: String(agent.temperature),
    maxOutputTokens: String(agent.maxOutputTokens),
    isActive: agent.isActive,
  };
}

/**
 * Saves the assistant's configuration.
 *
 * Every field is read by name. A `formData` entry with no member in the schema is not parsed,
 * not defaulted, and never reaches the service — which is the same guarantee the schema gives,
 * stated twice on purpose, because this is the boundary a browser is on the other side of.
 */
export async function updateAgentConfigAction(
  prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const parsed = updateAgentConfigSchema.safeParse({
    name: formData.get('name') ?? undefined,
    role: formData.get('role') ?? undefined,
    tone: formData.get('tone') ?? undefined,
    persona: formData.get('persona') ?? undefined,
    greeting: formData.get('greeting') ?? undefined,
    customInstructions: formData.get('customInstructions') ?? undefined,
    handoffKeywords: formData.get('handoffKeywords') ?? undefined,
    temperature: formData.get('temperature') ?? undefined,
    maxOutputTokens: formData.get('maxOutputTokens') ?? undefined,
    isActive: formData.get('isActive') ?? undefined,
  });

  if (!parsed.success) {
    // The serial is carried, not advanced: nothing was saved, so nothing on screen should be
    // replaced with a stored value.
    return {
      ...validationFormState(parsed.error),
      values: postedValues(formData),
      savedSerial: prev.savedSerial,
    };
  }

  try {
    const ctx = await requireTenantContext();
    const agent = await updateAgentConfiguration(ctx, parsed.data);

    revalidatePath(AGENT_PATH);

    // Deactivation is the one save whose consequence is not visible on the screen that made
    // it, so the confirmation says what changed rather than "Saved".
    return {
      status: 'success',
      values: savedValues(agent),
      savedSerial: (prev.savedSerial ?? 0) + 1,
      message: agent.isActive
        ? 'Saved. Your assistant is answering customers with these settings.'
        : 'Saved. Your assistant is switched off and will not reply to customers.',
    };
  } catch (error) {
    // A refused permission or a failed write leaves the owner's edits on screen too: the save
    // did not happen, so the form is still their unsaved work rather than a stale copy of the row.
    return { ...formErrorFrom(error), values: postedValues(formData), savedSerial: prev.savedSerial };
  }
}

/**
 * Creates the workspace's assistant.
 *
 * For workspaces provisioned before signup started creating one. The screen offers this
 * instead of writing to the database while rendering a page, and the underlying
 * `ensureDefaultAgent` is idempotent by lookup, so a double-click cannot produce two.
 *
 * Takes the `useActionState` signature it will never read a field from, so the empty state can
 * report a failure in the same `FormAlert` every other form on the product uses.
 */
export async function provisionAgentAction(
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requireTenantContext();
    await provisionAgentConfig(ctx);

    revalidatePath(AGENT_PATH);

    return {
      status: 'success',
      message: 'Your AI assistant is ready. Give it a name and tell it about your business.',
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}
