'use server';

/**
 * Workspace server actions: create the first (or another) workspace, and switch
 * the active one.
 *
 * Switching is an authorisation decision disguised as a convenience: the slug
 * arrives from the client, so membership is re-verified through
 * `getTenantContext` before the active-workspace cookie is written. A slug the
 * caller does not belong to resolves to null and bounces them to the picker —
 * the cookie can never be used to reach a workspace they are not in.
 */

import { redirect } from 'next/navigation';

import type { FormState } from '@/lib/form-state';
import { setActiveWorkspaceCookie } from '@/server/auth/cookies';
import { getRequestMeta } from '@/server/http/request-meta';
import { getSessionActorRenewing, getTenantContext } from '@/server/tenancy/resolve';
import { createWorkspace } from '@/server/services/workspace/workspace.service';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import { createWorkspaceSchema, switchWorkspaceSchema } from '@/server/validation/workspace';

export async function createWorkspaceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getSessionActorRenewing();
  if (!actor) redirect('/login');

  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get('name'),
    category: formData.get('category'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const meta = await getRequestMeta();
    const workspace = await createWorkspace({
      userId: actor.user.id,
      name: parsed.data.name,
      category: parsed.data.category,
      meta,
    });
    await setActiveWorkspaceCookie(workspace.slug);
  } catch (error) {
    return formErrorFrom(error);
  }

  redirect('/dashboard');
}

export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const parsed = switchWorkspaceSchema.safeParse({ slug: formData.get('slug') });
  if (!parsed.success) redirect('/select-workspace');

  const context = await getTenantContext(parsed.data.slug);
  if (!context) redirect('/select-workspace');

  await setActiveWorkspaceCookie(context.workspaceSlug);
  redirect('/dashboard');
}
