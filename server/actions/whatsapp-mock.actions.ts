'use server';

/**
 * Mock WhatsApp Server Actions.
 *
 * Safe dev/test server actions to inject simulated customer messages and
 * delivery status receipts. Strictly authenticated, tenant-scoped, and restricted
 * from production environments where MOCK_WHATSAPP is disabled.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { FormState } from '@/lib/form-state';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import { ForbiddenError } from '@/server/errors';
import { processInboundMessage, processStatusUpdate } from '@/server/services/whatsapp/inbound.service';
import { requirePermission } from '@/server/tenancy/context';
import { requireTenantContext } from '@/server/tenancy/resolve';

const mockInboundSchema = z.object({
  fromPhone: z.string().min(1, 'Phone number is required'),
  body: z.string().min(1, 'Message body is required').max(4096),
  waProfileName: z.string().max(128).optional().nullable(),
  providerMessageId: z.string().optional(),
});

const mockStatusSchema = z.object({
  providerMessageId: z.string().min(1, 'Provider message ID is required'),
  status: z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED']),
  errorCode: z.string().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
});

function revalidateInbox() {
  revalidatePath('/conversations');
  revalidatePath('/inbox');
}

/**
 * Injects a simulated customer WhatsApp message into the current workspace.
 */
export async function injectMockInboundAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = mockInboundSchema.safeParse({
    fromPhone: formData.get('fromPhone'),
    body: formData.get('body'),
    waProfileName: formData.get('waProfileName') || undefined,
    providerMessageId: formData.get('providerMessageId') || undefined,
  });

  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    requirePermission(ctx, 'conversation:reply');

    const providerMessageId =
      parsed.data.providerMessageId ||
      `wamid.mock_in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const result = await processInboundMessage(ctx, {
      type: 'TEXT',
      providerMessageId,
      fromPhone: parsed.data.fromPhone,
      waProfileName: parsed.data.waProfileName,
      body: parsed.data.body,
      occurredAt: new Date(),
    });

    revalidateInbox();

    return {
      status: 'success',
      message: result.isDuplicate
        ? 'Duplicate mock message received (idempotent).'
        : 'Mock customer message received.',
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}

/**
 * Injects a simulated status receipt (DELIVERED / READ / FAILED) for a sent message.
 */
export async function injectMockStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = mockStatusSchema.safeParse({
    providerMessageId: formData.get('providerMessageId'),
    status: formData.get('status'),
    errorCode: formData.get('errorCode') || undefined,
    errorMessage: formData.get('errorMessage') || undefined,
  });

  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    requirePermission(ctx, 'conversation:reply');

    const result = await processStatusUpdate(ctx, {
      type: 'STATUS',
      providerMessageId: parsed.data.providerMessageId,
      status: parsed.data.status,
      occurredAt: new Date(),
      errorCode: parsed.data.errorCode,
      errorMessage: parsed.data.errorMessage,
    });

    if (!result.updated && result.reason === 'NOT_FOUND') {
      throw new ForbiddenError('Message not found in current workspace.');
    }

    revalidateInbox();

    return {
      status: 'success',
      message: `Status updated to ${parsed.data.status}.`,
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}
