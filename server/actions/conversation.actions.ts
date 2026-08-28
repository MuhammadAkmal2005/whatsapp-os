'use server';

/**
 * Conversation server actions.
 *
 * Thin adapters: parse, delegate, translate. Every one resolves its own tenant
 * context rather than accepting a workspace id, so the scope comes from the
 * session cookie and a crafted form post cannot mutate another business's thread.
 */

import { revalidatePath } from 'next/cache';

import type { FormState } from '@/lib/form-state';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import { getRequestMeta } from '@/server/http/request-meta';
import {
  assignConversation,
  createConversation,
  toggleConversationAi,
  updateConversationPriority,
  updateConversationStatus,
} from '@/server/services/conversation/conversation.service';
import { sendMessage } from '@/server/services/conversation/message.service';
import { requireTenantContext } from '@/server/tenancy/resolve';
import {
  assignConversationSchema,
  createConversationSchema,
  sendMessageSchema,
  toggleConversationAiSchema,
  updateConversationPrioritySchema,
  updateConversationStatusSchema,
} from '@/server/validation/conversation';

function revalidateInbox() {
  revalidatePath('/conversations');
  revalidatePath('/inbox');
}

export async function createConversationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const initialBody = formData.get('initialMessageBody');

  const parsed = createConversationSchema.safeParse({
    contactId: formData.get('contactId'),
    channel: formData.get('channel') ?? undefined,
    phoneNumberId: formData.get('phoneNumberId') ?? undefined,
    status: formData.get('status') ?? undefined,
    priority: formData.get('priority') ?? undefined,
    assignedToMemberId: formData.get('assignedToMemberId') ?? undefined,
    initialMessage: initialBody
      ? {
          body: initialBody,
          type: formData.get('initialMessageType') ?? 'TEXT',
        }
      : undefined,
  });

  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await createConversation(ctx, parsed.data, await getRequestMeta());
    revalidateInbox();
    return {
      status: 'success',
      message: 'Conversation started.',
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}

export async function sendMessageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = sendMessageSchema.safeParse({
    conversationId: formData.get('conversationId'),
    direction: formData.get('direction') ?? 'OUTBOUND',
    type: formData.get('type') ?? 'TEXT',
    body: formData.get('body'),
    status: formData.get('status') ?? undefined,
  });

  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await sendMessage(ctx, parsed.data, await getRequestMeta());
    revalidateInbox();
    return {
      status: 'success',
      message: 'Message sent.',
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}

export async function updateConversationStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateConversationStatusSchema.safeParse({
    conversationId: formData.get('conversationId'),
    status: formData.get('status'),
  });

  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await updateConversationStatus(ctx, parsed.data, await getRequestMeta());
    revalidateInbox();
    return { status: 'success', message: 'Status updated.' };
  } catch (error) {
    return formErrorFrom(error);
  }
}

export async function assignConversationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = assignConversationSchema.safeParse({
    conversationId: formData.get('conversationId'),
    assignedToMemberId: formData.get('assignedToMemberId'),
  });

  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await assignConversation(ctx, parsed.data, await getRequestMeta());
    revalidateInbox();
    return { status: 'success', message: 'Assignee updated.' };
  } catch (error) {
    return formErrorFrom(error);
  }
}

export async function updateConversationPriorityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateConversationPrioritySchema.safeParse({
    conversationId: formData.get('conversationId'),
    priority: formData.get('priority'),
  });

  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await updateConversationPriority(ctx, parsed.data, await getRequestMeta());
    revalidateInbox();
    return { status: 'success', message: 'Priority updated.' };
  } catch (error) {
    return formErrorFrom(error);
  }
}

export async function toggleConversationAiAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = toggleConversationAiSchema.safeParse({
    conversationId: formData.get('conversationId'),
    aiEnabled: formData.get('aiEnabled') === 'true' || formData.get('aiEnabled') === 'on',
    handoffReason: formData.get('handoffReason') ?? undefined,
  });

  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await toggleConversationAi(ctx, parsed.data, await getRequestMeta());
    revalidateInbox();
    return { status: 'success', message: 'AI settings updated.' };
  } catch (error) {
    return formErrorFrom(error);
  }
}
