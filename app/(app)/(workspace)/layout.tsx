import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell/app-shell';
import { listUserWorkspaces } from '@/server/services/workspace/workspace.service';
import { getSessionActor, getTenantContext } from '@/server/tenancy/resolve';

/**
 * The boundary for everything inside a workspace.
 *
 * The parent `(app)` layout has already proven the caller is signed in; this one
 * resolves which workspace they are acting in, from the active-workspace cookie.
 * A missing or stale cookie — no workspace, or one they have since left —
 * resolves to null and bounces to the picker, which in turn sends a brand-new
 * account on to onboarding. The resolved `TenantContext` is the single source of
 * the workspace identity the shell renders; nothing here trusts a value from the
 * client.
 *
 * The two reads run concurrently on purpose. The switcher's workspace list is
 * scoped by user, not by workspace, so it needs only the id the session already
 * established — awaiting the membership check first made it a third serial
 * database wave for no reason. `getSessionActor` is memoised per request, so
 * reading it here costs nothing: the parent layout has already resolved it, and
 * `getTenantContext` below shares the same lookup.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const actor = await getSessionActor();
  if (!actor) redirect('/login');

  const [context, workspaces] = await Promise.all([
    getTenantContext(),
    listUserWorkspaces(actor.user.id),
  ]);
  if (!context) redirect('/select-workspace');

  return (
    <AppShell
      user={{
        name: context.user.name,
        email: context.user.email,
        avatarUrl: context.user.avatarUrl,
      }}
      role={context.role}
      current={{ id: context.workspaceId, slug: context.workspaceSlug, name: context.workspaceName }}
      workspaces={workspaces.map((workspace) => ({
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
      }))}
    >
      {children}
    </AppShell>
  );
}

