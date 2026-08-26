'use server';

/**
 * Team management server actions.
 *
 * Thin adapters, deliberately: parse, delegate, translate. Every one of them
 * resolves its own tenant context rather than accepting a workspace id, so the
 * scope comes from the session cookie and a crafted form post cannot redirect a
 * role change into another business.
 *
 * Note that none of these check permissions themselves. `requirePermission` runs
 * inside the service, which is the only place all entry points share — putting it
 * here as well would read as thorough while actually creating two places for the
 * rule to drift apart.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { type FormState } from '@/lib/form-state';
import { clearActiveWorkspaceCookie, setActiveWorkspaceCookie } from '@/server/auth/cookies';
import { getRequestMeta } from '@/server/http/request-meta';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import { RateLimitError } from '@/server/errors';
import { consume } from '@/server/ratelimit/limiter';
import {
  acceptInvite,
  changeMemberRole,
  inviteMember,
  leaveWorkspace,
  removeMember,
  revokeInvite,
  setMemberStatus,
  transferOwnership,
} from '@/server/services/member/member.service';
import { requireTenantContext, requireUserContext } from '@/server/tenancy/resolve';
import {
  acceptInviteSchema,
  inviteMemberSchema,
  removeMemberSchema,
  revokeInviteSchema,
  suspendMemberSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
} from '@/server/validation/member';

const TEAM_PATH = '/settings/team';

/**
 * Carries the generated link back to the page.
 *
 * The link is shown once and never stored in retrievable form, so it travels in
 * the action result rather than being fetched afterwards. `FormState` has no field
 * for it, hence the extension here rather than widening the shared type — only
 * this one form needs it.
 */
export type InviteFormState = FormState & {
  invite?: { email: string; url: string; expiresAt: string };
};

export async function inviteMemberAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();

    // Per workspace, not per user: an admin and an owner sharing a shop should
    // share one allowance, or the limit is trivially doubled by asking a colleague.
    const decision = await consume('memberInvite', `workspace:${ctx.workspaceId}`);
    if (!decision.allowed) {
      throw new RateLimitError(decision.retryAfterSeconds);
    }

    const meta = await getRequestMeta();
    const result = await inviteMember(ctx, parsed.data, meta);

    revalidatePath(TEAM_PATH);
    return {
      status: 'success',
      message: `Invitation ready for ${result.email}. Share the link below — it works once.`,
      invite: {
        email: result.email,
        url: result.inviteUrl,
        expiresAt: result.expiresAt.toISOString(),
      },
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}

export async function changeMemberRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateMemberRoleSchema.safeParse({
    memberId: formData.get('memberId'),
    role: formData.get('role'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await changeMemberRole(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(TEAM_PATH);
  return { status: 'success', message: 'Role updated.' };
}

export async function setMemberStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = suspendMemberSchema.safeParse({
    memberId: formData.get('memberId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await setMemberStatus(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(TEAM_PATH);
  return {
    status: 'success',
    message:
      parsed.data.status === 'SUSPENDED'
        ? 'Access paused. They stay on your team and can be reactivated any time.'
        : 'Access restored.',
  };
}

export async function removeMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = removeMemberSchema.safeParse({ memberId: formData.get('memberId') });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await removeMember(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(TEAM_PATH);
  return { status: 'success', message: 'Team member removed.' };
}

export async function revokeInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = revokeInviteSchema.safeParse({ inviteId: formData.get('inviteId') });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await revokeInvite(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(TEAM_PATH);
  return { status: 'success', message: 'Invitation cancelled. That link no longer works.' };
}

export async function transferOwnershipAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = transferOwnershipSchema.safeParse({
    memberId: formData.get('memberId'),
    confirmEmail: formData.get('confirmEmail'),
    expectedEmail: formData.get('expectedEmail'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    // Only `memberId` is passed on. The two email fields exist to make the person
    // type out who they are handing the business to; the service re-reads the
    // member row and never trusts the form's idea of whose address that is.
    await transferOwnership(ctx, { memberId: parsed.data.memberId }, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(TEAM_PATH);
  return {
    status: 'success',
    message: 'Ownership transferred. You are now an admin of this business.',
  };
}

export async function leaveWorkspaceAction(_prev: FormState): Promise<FormState> {
  try {
    const ctx = await requireTenantContext();
    await leaveWorkspace(ctx, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  // Their membership is gone, so the active-workspace cookie now points at a
  // workspace they cannot resolve. Clearing it sends them to the picker instead of
  // a dead end.
  await clearActiveWorkspaceCookie();
  redirect('/select-workspace');
}

export async function acceptInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = acceptInviteSchema.safeParse({ token: formData.get('token') });
  if (!parsed.success) return validationFormState(parsed.error);

  let slug: string;
  try {
    const user = await requireUserContext();
    const joined = await acceptInvite(
      parsed.data.token,
      { id: user.user.id, email: user.user.email },
      await getRequestMeta(),
    );
    slug = joined.workspaceSlug;
  } catch (error) {
    return formErrorFrom(error);
  }

  await setActiveWorkspaceCookie(slug);
  redirect('/dashboard');
}
