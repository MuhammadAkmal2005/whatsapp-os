/**
 * Validation schemas for team management.
 *
 * The same schemas back the settings forms and the server actions, so the browser
 * and the server cannot disagree about what a valid invitation is.
 *
 * Note what is *not* here: the workspace id. Every one of these operations resolves
 * its scope from the session's tenant context. Accepting a workspace id from the
 * form would mean an ADMIN of one business could post a member id belonging to
 * another and have the server dutifully scope to the wrong tenant.
 */

import { z } from 'zod';

import { ASSIGNABLE_ROLES, type AssignableRole } from '@/server/authz/permissions';

const EMAIL_MAX = 254; // RFC 5321 upper bound on a forward path.

/**
 * Re-exported so a caller reaching for "the roles a form may offer" finds it next to
 * the schema that accepts them. The list itself lives in `server/authz/permissions`,
 * which the pure domain rules can import without pulling in a validation library.
 */
export { ASSIGNABLE_ROLES };

/**
 * The role enum the forms post. OWNER is absent at the schema boundary as well as in
 * the rules, so a crafted form post is rejected before any business logic runs.
 *
 * Spelled out rather than derived, because Zod needs a literal tuple. The two
 * assignments below keep it in step with `ASSIGNABLE_ROLES` in both directions, so
 * adding a role and forgetting this line fails the type check instead of silently
 * rejecting the new role at the boundary.
 */
const ASSIGNABLE_ROLE_VALUES = ['ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const;

const _tupleHoldsOnlyAssignableRoles: readonly AssignableRole[] = ASSIGNABLE_ROLE_VALUES;
const _tupleHoldsEveryAssignableRole: readonly (typeof ASSIGNABLE_ROLE_VALUES)[number][] =
  ASSIGNABLE_ROLES;
void _tupleHoldsOnlyAssignableRoles;
void _tupleHoldsEveryAssignableRole;

const assignableRole = z.enum(ASSIGNABLE_ROLE_VALUES, {
  errorMap: () => ({ message: 'Choose a role for this person.' }),
});

const memberId = z.string().uuid('That team member reference is not valid.');

export const inviteMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Enter an email address.')
    .max(EMAIL_MAX, 'That email address is too long.')
    .email('Enter a valid email address, like ahmed@example.com.'),
  role: assignableRole,
});

export const updateMemberRoleSchema = z.object({
  memberId,
  role: assignableRole,
});

export const removeMemberSchema = z.object({ memberId });

export const suspendMemberSchema = z.object({
  memberId,
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

export const revokeInviteSchema = z.object({
  inviteId: z.string().uuid('That invitation reference is not valid.'),
});

/**
 * Transferring ownership asks for the recipient's email to be typed out.
 *
 * A dropdown alone is one misclick away from handing over a business, and unlike a
 * role change this one cannot be undone by the person who made the mistake — only
 * the new owner can give it back. Typing the address is the confirmation step.
 */
export const transferOwnershipSchema = z
  .object({
    memberId,
    confirmEmail: z.string().trim().toLowerCase().min(1, 'Type their email address to confirm.'),
    expectedEmail: z.string().trim().toLowerCase(),
  })
  .refine((value) => value.confirmEmail === value.expectedEmail, {
    path: ['confirmEmail'],
    message: 'That does not match their email address.',
  });

export const acceptInviteSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, 'This invitation link is incomplete.')
    // 32 bytes base64url — a length check rejects obvious junk before a database read.
    .max(128, 'This invitation link is not valid.'),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
export type SuspendMemberInput = z.infer<typeof suspendMemberSchema>;
export type RevokeInviteInput = z.infer<typeof revokeInviteSchema>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
