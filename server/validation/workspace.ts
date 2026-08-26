/**
 * Validation schemas for workspace operations.
 *
 * Shared between the onboarding form and the create-workspace action. The
 * category is free text bounded by a max length — the offered list in
 * `BUSINESS_CATEGORIES` is a convenience, not a closed set, so a business that
 * does not fit any label is never turned away.
 */

import { z } from 'zod';

const WORKSPACE_NAME_MAX = 80;
const CATEGORY_MAX = 60;

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Please enter a business name of at least 2 characters.')
    .max(WORKSPACE_NAME_MAX, 'That business name is too long.'),
  category: z
    .string()
    .trim()
    .max(CATEGORY_MAX, 'That category name is too long.')
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

export const switchWorkspaceSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, 'Choose a workspace.')
    .max(120, 'That workspace reference is not valid.'),
});

export type CreateWorkspaceFormInput = z.infer<typeof createWorkspaceSchema>;
export type SwitchWorkspaceInput = z.infer<typeof switchWorkspaceSchema>;
