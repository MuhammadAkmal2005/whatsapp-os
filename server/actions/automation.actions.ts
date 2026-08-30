'use server';

/**
 * Automation Server Actions.
 *
 * Thin adapters for creating, updating, toggling, deleting, and manually testing
 * automations from the workspace dashboard. Resolves tenant context from the session.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { type FormState } from '@/lib/form-state';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import {
  createAutomation,
  deleteAutomation,
  toggleAutomation,
  updateAutomation,
} from '@/server/services/automation/automation.service';
import { triggerAutomations } from '@/server/services/automation/automation-engine.service';
import { requireTenantContext } from '@/server/tenancy/resolve';
import {
  createAutomationSchema,
  updateAutomationSchema,
  uuidSchema,
} from '@/server/validation/automation';
import { prisma } from '@/db/prisma';

const AUTOMATIONS_PATH = '/automations';

function parseJsonField<T>(value: FormDataEntryValue | null): T | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * Creates an automation and redirects to its detail page.
 */
export async function createAutomationAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await requireTenantContext();

  const rawJson = formData.get('payload');
  let rawData: Record<string, unknown>;

  if (typeof rawJson === 'string' && rawJson.trim()) {
    try {
      rawData = JSON.parse(rawJson);
    } catch {
      return {
        status: 'error',
        message: 'Invalid automation JSON payload format.',
      };
    }
  } else {
    rawData = {
      name: formData.get('name'),
      description: formData.get('description') || undefined,
      isActive: formData.get('isActive') === 'true' || formData.get('isActive') === 'on',
      triggerType: formData.get('triggerType'),
      triggerConfig: parseJsonField(formData.get('triggerConfig')),
      actions: parseJsonField(formData.get('actions')) ?? [],
    };
  }

  const parsed = createAutomationSchema.safeParse(rawData);
  if (!parsed.success) {
    return validationFormState(parsed.error);
  }

  let createdId: string;
  try {
    const created = await createAutomation(context, parsed.data);
    createdId = created.id;
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(AUTOMATIONS_PATH);
  redirect(`${AUTOMATIONS_PATH}/${createdId}`);
}

/**
 * Updates an existing automation.
 */
export async function updateAutomationAction(
  id: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await requireTenantContext();

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    return { status: 'error', message: 'Invalid automation ID.' };
  }

  const rawJson = formData.get('payload');
  let rawData: Record<string, unknown>;

  if (typeof rawJson === 'string' && rawJson.trim()) {
    try {
      rawData = JSON.parse(rawJson);
    } catch {
      return {
        status: 'error',
        message: 'Invalid automation JSON payload format.',
      };
    }
  } else {
    rawData = {
      name: formData.get('name') ?? undefined,
      description: formData.get('description') !== null ? (formData.get('description') || null) : undefined,
      isActive: formData.has('isActive')
        ? formData.get('isActive') === 'true' || formData.get('isActive') === 'on'
        : undefined,
      triggerType: formData.get('triggerType') ?? undefined,
      triggerConfig: formData.has('triggerConfig') ? parseJsonField(formData.get('triggerConfig')) : undefined,
      actions: formData.has('actions') ? parseJsonField(formData.get('actions')) : undefined,
    };
  }

  const parsed = updateAutomationSchema.safeParse(rawData);
  if (!parsed.success) {
    return validationFormState(parsed.error);
  }

  try {
    await updateAutomation(context, id, parsed.data);
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(AUTOMATIONS_PATH);
  revalidatePath(`${AUTOMATIONS_PATH}/${id}`);

  return {
    status: 'success',
    message: 'Automation saved successfully.',
  };
}

/**
 * Toggles an automation's active state.
 */
export async function toggleAutomationAction(
  id: string,
  isActive: boolean,
): Promise<FormState> {
  const context = await requireTenantContext();

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    return { status: 'error', message: 'Invalid automation ID.' };
  }

  try {
    await toggleAutomation(context, id, isActive);
    revalidatePath(AUTOMATIONS_PATH);
    revalidatePath(`${AUTOMATIONS_PATH}/${id}`);
    return {
      status: 'success',
      message: isActive ? 'Automation activated.' : 'Automation deactivated.',
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}

/**
 * Deletes an automation and redirects to the automations list.
 */
export async function deleteAutomationAction(id: string): Promise<FormState> {
  const context = await requireTenantContext();

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    return { status: 'error', message: 'Invalid automation ID.' };
  }

  try {
    await deleteAutomation(context, id);
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(AUTOMATIONS_PATH);
  redirect(AUTOMATIONS_PATH);
}

/**
 * Manually triggers a test run of an automation for testing/verification.
 */
export async function testTriggerAutomationAction(
  id: string,
  testData: Record<string, unknown> = {},
): Promise<FormState> {
  const context = await requireTenantContext();

  const idParsed = uuidSchema.safeParse(id);
  if (!idParsed.success) {
    return { status: 'error', message: 'Invalid automation ID.' };
  }

  try {
    const automation = await prisma.automation.findFirst({
      where: { id, workspaceId: context.workspaceId },
      include: { actions: true },
    });

    if (!automation) {
      return { status: 'error', message: 'Automation not found.' };
    }

    // Find or create a test conversation / subject
    const dummyConversation = await prisma.conversation.findFirst({
      where: { workspaceId: context.workspaceId },
    });

    const subjectId = dummyConversation ? dummyConversation.id : id;

    const results = await triggerAutomations(prisma, context.workspaceId, {
      triggerType: automation.triggerType,
      subjectType: 'Conversation',
      subjectId,
      eventKey: `test:${Date.now()}`,
      data: {
        body: 'Test manual trigger',
        text: 'Test manual trigger',
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
        fromStage: 'NEW',
        toStage: 'QUALIFIED',
        available: 1,
        idleMinutes: 120,
        ...testData,
      },
    });

    revalidatePath(AUTOMATIONS_PATH);
    revalidatePath(`${AUTOMATIONS_PATH}/${id}`);

    return {
      status: 'success',
      message: `Test run triggered successfully (${results.length} execution${results.length === 1 ? '' : 's'}).`,
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}
