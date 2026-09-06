/**
 * Validation for the Meta Embedded Signup callback.
 *
 * Meta's asset ids are opaque decimal strings, so the schema constrains shape and length
 * and nothing more — a stricter pattern would be a guess about Meta's id format that
 * breaks the day they widen it. The real check on these values is not here: the onboarding
 * service reads the WABA back with the exchanged token and requires the phone number to
 * appear on it, so a well-formed id belonging to someone else still fails.
 *
 * The authorization code is capped generously and never logged. It is a single-use
 * credential with a ~30 second life, which is why it is validated and spent immediately
 * rather than queued.
 */

import { z } from 'zod';

/** Digits only: every WABA, phone number and business id Meta issues is a decimal string. */
const metaAssetId = z
  .string()
  .trim()
  .min(1, 'Missing an ID from Meta. Please start the connection again.')
  .max(64, 'That ID from Meta is not valid.')
  .regex(/^\d+$/, 'That ID from Meta is not valid.');

export const completeEmbeddedSignupSchema = z.object({
  /** Opaque to us; exchanged server-side and never stored. */
  code: z
    .string()
    .trim()
    .min(1, 'Meta did not return an authorization code. Please start the connection again.')
    .max(2048, 'The authorization code from Meta is not valid.'),
  /** Claimed by the browser, verified against Meta before anything is written. */
  wabaId: metaAssetId,
  phoneNumberId: metaAssetId,
  /** CSRF state issued when the dialog was opened. */
  state: z
    .string()
    .trim()
    .min(1, 'This connection attempt has expired. Please start again.')
    .max(512, 'This connection attempt is not valid. Please start again.'),
});

export const runConnectionHealthCheckSchema = z.object({
  accountId: z.string().uuid('Invalid account ID.'),
});

export type CompleteEmbeddedSignupInput = z.infer<typeof completeEmbeddedSignupSchema>;
export type RunConnectionHealthCheckInput = z.infer<typeof runConnectionHealthCheckSchema>;
