'use client';

/**
 * The four details Meta gives you, and the token that authorises us to use them.
 *
 * Every label names the thing the owner is copying from Meta's own screens, because the only way
 * to fill this in is to have Business Manager open in another tab — a friendlier invented name
 * would make the two harder to match, not easier. The one field that is ours, the connection
 * name, says so.
 *
 * The token is a password field with no default value: it is never sent back to the browser after
 * it is saved, so an update means pasting it again rather than editing what is already there.
 */

import { useActionState } from 'react';

import { FormAlert } from '@/components/ui/form-alert';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { connectWhatsAppAction } from '@/server/actions/whatsapp-account.actions';

type ConnectWhatsAppFormProps = {
  initialValues?: {
    wabaId?: string;
    phoneNumberId?: string;
    displayPhoneNumber?: string;
    displayName?: string | null;
  };
  isUpdate?: boolean;
};

export function ConnectWhatsAppForm({ initialValues, isUpdate = false }: ConnectWhatsAppFormProps) {
  const [state, formAction] = useActionState(connectWhatsAppAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormAlert state={state} successTitle="WhatsApp is connected" />

      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <FormField error={fieldErrors?.wabaId?.[0]}>
          <FormLabel>WhatsApp Business account ID</FormLabel>
          <FormControl>
            <Input
              name="wabaId"
              type="text"
              defaultValue={initialValues?.wabaId ?? ''}
              placeholder="109876543210987"
              required
              maxLength={128}
            />
          </FormControl>
          <FormDescription>
            Meta shows this in Business Manager, under WhatsApp accounts.
          </FormDescription>
        </FormField>

        <FormField error={fieldErrors?.phoneNumberId?.[0]}>
          <FormLabel>Phone number ID</FormLabel>
          <FormControl>
            <Input
              name="phoneNumberId"
              type="text"
              defaultValue={initialValues?.phoneNumberId ?? ''}
              placeholder="106540352242922"
              required
              maxLength={128}
            />
          </FormControl>
          <FormDescription>
            Meta&rsquo;s ID for the number, listed next to it — not the number itself.
          </FormDescription>
        </FormField>

        <FormField error={fieldErrors?.displayPhoneNumber?.[0]}>
          <FormLabel>Your WhatsApp number</FormLabel>
          <FormControl>
            <Input
              name="displayPhoneNumber"
              type="tel"
              defaultValue={initialValues?.displayPhoneNumber ?? ''}
              placeholder="+92 300 1234567"
              required
              maxLength={32}
            />
          </FormControl>
          <FormDescription>
            The number your customers already message, with its country code.
          </FormDescription>
        </FormField>

        <FormField error={fieldErrors?.displayName?.[0]}>
          <FormLabel>Name for this connection (optional)</FormLabel>
          <FormControl>
            <Input
              name="displayName"
              type="text"
              defaultValue={initialValues?.displayName ?? ''}
              placeholder="Shop enquiries"
              maxLength={128}
            />
          </FormControl>
          <FormDescription>
            Only your team sees this. Leave it empty and we show the number instead.
          </FormDescription>
        </FormField>

        <FormField error={fieldErrors?.accessToken?.[0]} className="sm:col-span-2">
          <FormLabel>System user access token</FormLabel>
          <FormControl>
            <Input
              name="accessToken"
              type="password"
              autoComplete="new-password"
              placeholder="Paste the permanent token from Meta"
              required
              maxLength={1024}
            />
          </FormControl>
          <FormDescription>
            {isUpdate
              ? 'Paste the token again, even if it has not changed — we cannot read back the one already saved.'
              : 'Create a permanent token for a system user in Meta Business Manager. We store it encrypted and never show it again.'}
          </FormDescription>
        </FormField>
      </div>

      <div className="flex justify-end">
        <SubmitButton pendingText={isUpdate ? 'Saving…' : 'Connecting…'}>
          {isUpdate ? 'Save and reconnect' : 'Connect WhatsApp'}
        </SubmitButton>
      </div>
    </form>
  );
}
