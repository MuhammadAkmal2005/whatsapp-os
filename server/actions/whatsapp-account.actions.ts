'use server';

/**
 * WhatsApp Business Account Server Actions.
 *
 * Provides client form actions for connecting and disconnecting WhatsApp Business numbers.
 * Enforces tenant authentication and permission checks.
 */

import { revalidatePath } from 'next/cache';

import type { FormState } from '@/lib/form-state';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import {
  connectWhatsAppAccount,
  disconnectWhatsAppAccount,
} from '@/server/services/whatsapp/whatsapp-account.service';
import { requireTenantContext } from '@/server/tenancy/resolve';
import {
  connectWhatsAppSchema,
  disconnectWhatsAppSchema,
} from '@/server/validation/whatsapp-account';

function revalidateWhatsAppSettings() {
  revalidatePath('/settings/whatsapp');
  revalidatePath('/conversations');
  revalidatePath('/inbox');
}

/**
 * Server action to connect or update a WhatsApp Business Account.
 */
export async function connectWhatsAppAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = connectWhatsAppSchema.safeParse({
    wabaId: formData.get('wabaId'),
    phoneNumberId: formData.get('phoneNumberId'),
    displayPhoneNumber: formData.get('displayPhoneNumber'),
    accessToken: formData.get('accessToken'),
    displayName: formData.get('displayName') || undefined,
  });

  if (!parsed.success) {
    return validationFormState(parsed.error);
  }

  try {
    const ctx = await requireTenantContext();
    const result = await connectWhatsAppAccount(ctx, parsed.data);

    revalidateWhatsAppSettings();

    return {
      status: 'success',
      message: result.isMock
        ? 'WhatsApp connected in Simulated (Mock) Mode.'
        : 'WhatsApp Business Account connected successfully.',
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}

/**
 * Server action to disconnect a WhatsApp Business Account.
 */
export async function disconnectWhatsAppAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = disconnectWhatsAppSchema.safeParse({
    accountId: formData.get('accountId'),
  });

  if (!parsed.success) {
    return validationFormState(parsed.error);
  }

  try {
    const ctx = await requireTenantContext();
    await disconnectWhatsAppAccount(ctx, parsed.data.accountId);

    revalidateWhatsAppSettings();

    return {
      status: 'success',
      message: 'WhatsApp Business Account disconnected.',
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}
