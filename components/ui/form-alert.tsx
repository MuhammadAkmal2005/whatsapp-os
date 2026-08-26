'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { FormState } from '@/lib/form-state';

/**
 * Renders the form-level outcome of a server action — the message that is not
 * tied to a single field, like "Invalid email or password" or a success note.
 * Field-level messages render inline on their `FormField`; this is for the rest.
 *
 * When a request id is present it is shown quietly: it means something
 * unexpected failed, and it is the string a user can quote to support so the
 * incident can be found in the logs.
 */
export function FormAlert({ state, successTitle }: { state: FormState; successTitle?: string }) {
  if (state.status === 'error' && state.message) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>Something needs your attention</AlertTitle>
        <AlertDescription>
          {state.message}
          {state.requestId ? (
            <span className="mt-1 block font-mono text-2xs text-muted-foreground">
              Reference: {state.requestId}
            </span>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (state.status === 'success' && (state.message || successTitle)) {
    return (
      <Alert variant="success">
        <CheckCircle2 aria-hidden />
        {successTitle ? <AlertTitle>{successTitle}</AlertTitle> : null}
        {state.message ? <AlertDescription>{state.message}</AlertDescription> : null}
      </Alert>
    );
  }

  return null;
}
