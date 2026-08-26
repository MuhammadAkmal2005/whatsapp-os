/**
 * Validation schemas for authentication.
 *
 * One schema per operation, shared between the form and the server action so the
 * client and the server cannot disagree about what "valid" means. The action is
 * the authority — it re-parses on the server, because a schema enforced only in
 * the browser is decoration — but backing the form with the same rules gives
 * instant feedback without a round trip.
 *
 * Password *strength* (length, not-obvious) is checked in the auth service via
 * `checkPasswordStrength`, so the rule lives in exactly one place. Here we bound
 * only the shape and the outer length, and on login we deliberately do not hint
 * at the rules at all.
 */

import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/config/constants';

/** RFC-realistic ceilings so a field cannot be used to smuggle a huge payload. */
const NAME_MAX = 100;
const EMAIL_MAX = 254;

export const emailField = z
  .string()
  .trim()
  .min(1, 'Please enter your email address.')
  .max(EMAIL_MAX, 'That email address is too long.')
  .email('Please enter a valid email address.')
  .transform((value) => value.toLowerCase());

export const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Please enter your name.')
    .max(NAME_MAX, 'That name is too long.'),
  email: emailField,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, 'That password is too long.'),
});

export const loginSchema = z.object({
  email: emailField,
  // No minimum beyond "present": revealing the length rule on the login screen
  // only helps someone guessing, and a wrong length is a wrong password anyway.
  password: z.string().min(1, 'Please enter your password.'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
