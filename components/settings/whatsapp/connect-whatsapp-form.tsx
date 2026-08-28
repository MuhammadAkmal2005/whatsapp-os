'use client';

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

export function ConnectWhatsAppForm({
  initialValues,
  isUpdate = false,
}: ConnectWhatsAppFormProps) {
  const [state, formAction] = useActionState(connectWhatsAppAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.status === 'error' || state.status === 'success' ? (
        <FormAlert state={state} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.displayName?.[0]}>
          <FormLabel>Account Display Name (Optional)</FormLabel>
          <FormControl>
            <Input
              name="displayName"
              type="text"
              defaultValue={initialValues?.displayName ?? ''}
              placeholder="e.g. Akmal Fashion Support"
              maxLength={128}
            />
          </FormControl>
          <FormDescription>Internal label to identify this WhatsApp account.</FormDescription>
        </FormField>

        <FormField error={fieldErrors?.wabaId?.[0]}>
          <FormLabel>WhatsApp Business Account ID (WABA ID)</FormLabel>
          <FormControl>
            <Input
              name="wabaId"
              type="text"
              defaultValue={initialValues?.wabaId ?? ''}
              placeholder="e.g. 109876543210987"
              required
              maxLength={128}
            />
          </FormControl>
          <FormDescription>Found in Meta Business Manager under WhatsApp Accounts.</FormDescription>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.phoneNumberId?.[0]}>
          <FormLabel>Phone Number ID</FormLabel>
          <FormControl>
            <Input
              name="phoneNumberId"
              type="text"
              defaultValue={initialValues?.phoneNumberId ?? ''}
              placeholder="e.g. 106540352242922"
              required
              maxLength={128}
            />
          </FormControl>
          <FormDescription>Meta’s numeric identifier for your registered phone number.</FormDescription>
        </FormField>

        <FormField error={fieldErrors?.displayPhoneNumber?.[0]}>
          <FormLabel>Display Phone Number</FormLabel>
          <FormControl>
            <Input
              name="displayPhoneNumber"
              type="text"
              defaultValue={initialValues?.displayPhoneNumber ?? ''}
              placeholder="e.g. +92 300 1234567"
              required
              maxLength={32}
            />
          </FormControl>
          <FormDescription>Customer-facing phone number (E.164 format with country code).</FormDescription>
        </FormField>
      </div>

      <FormField error={fieldErrors?.accessToken?.[0]}>
        <FormLabel>{isUpdate ? 'Update System User Access Token' : 'System User Access Token'}</FormLabel>
        <FormControl>
          <Input
            name="accessToken"
            type="password"
            autoComplete="new-password"
            placeholder="Paste your permanent Meta System User token"
            required
            maxLength={1024}
          />
        </FormControl>
        <FormDescription>
          Encrypted securely at rest. Never shared with the client or logged.
        </FormDescription>
      </FormField>

      <div className="flex justify-end pt-2">
        <SubmitButton pendingText={isUpdate ? 'Updating connection…' : 'Connecting account…'}>
          {isUpdate ? 'Save & Reconnect' : 'Connect WhatsApp Business'}
        </SubmitButton>
      </div>
    </form>
  );
}
