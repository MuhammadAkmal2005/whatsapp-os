import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell/app-shell';
import { listUserWorkspaces } from '@/server/services/workspace/workspace.service';
import { getTenantContext } from '@/server/tenancy/resolve';

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
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const workspaces = await listUserWorkspaces(context.user.id);

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
