/**
 * The shape a form's server action returns.
 *
 * Client-safe on purpose: form components import this type, and they must not
 * pull in anything `server-only`. The server action fills it in; the form reads
 * `status`, shows `message` at the top and `fieldErrors[name]` under each input.
 *
 * A successful action almost always redirects instead of returning `success`,
 * but the state exists for the cases that stay on the page.
 */

export type FieldErrors = Record<string, string[]>;

export type FormState = {
  status: 'idle' | 'error' | 'success';
  /** A single sentence for the top of the form. Safe to show verbatim. */
  message?: string;
  /** Per-field problems, keyed by input name. */
  fieldErrors?: FieldErrors;
  /** Correlates a failure with the server log, for support. */
  requestId?: string;
};

export const IDLE_FORM_STATE: FormState = { status: 'idle' };
