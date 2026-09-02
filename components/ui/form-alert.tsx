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
 *
 * Both outcomes drop in rather than appearing instantly. This component renders `null` until
 * a form comes back, so the alert is genuinely new when it mounts — and on a long form the
 * short movement is what tells the reader something arrived above where they were typing.
 * `prefers-reduced-motion` collapses it to nothing, globally.
 *
 * Both are announced, because in both cases the outcome is the answer to something the user
 * just did and their attention may be at the button rather than here. A failure interrupts; a
 * confirmation waits for a pause.
 */
export function FormAlert({ state, successTitle }: { state: FormState; successTitle?: string }) {
  if (state.status === 'error' && state.message) {
    return (
      <Alert variant="destructive" live="assertive" className="animate-slide-down">
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
      <Alert variant="success" live="polite" className="animate-slide-down">
        <CheckCircle2 aria-hidden />
        {successTitle ? <AlertTitle>{successTitle}</AlertTitle> : null}
        {state.message ? <AlertDescription>{state.message}</AlertDescription> : null}
      </Alert>
    );
  }

  return null;
}
