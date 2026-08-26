import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';

import { PreWorkspaceShell } from '@/components/app-shell/pre-workspace-shell';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS } from '@/server/authz/permissions';
import { switchWorkspaceAction } from '@/server/actions/workspace.actions';
import { listUserWorkspaces } from '@/server/services/workspace/workspace.service';
import { getUserContext } from '@/server/tenancy/resolve';

export const metadata: Metadata = {
  title: 'Choose a workspace',
};

/**
 * The picker for someone who belongs to more than one business. Each row is a
 * real form posting to `switchWorkspaceAction`, which re-verifies membership
 * server-side before writing the active-workspace cookie — the slug in the
 * hidden field is a request, not a grant. A single-workspace user normally
 * never lands here (login routes them straight to the dashboard); if they do,
 * the one row still works. Zero workspaces means a fresh account, so we send
 * them to onboarding instead of showing an empty list.
 */
export default async function SelectWorkspacePage() {
  const context = await getUserContext();
  if (!context) redirect('/login');

  const workspaces = await listUserWorkspaces(context.user.id);
  if (workspaces.length === 0) redirect('/onboarding');

  return (
    <PreWorkspaceShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Choose a workspace</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;re a member of {workspaces.length} businesses. Pick the one you want to work in.
          </p>
        </div>

        <ul className="flex flex-col gap-2">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <form action={switchWorkspaceAction}>
                <input type="hidden" name="slug" value={workspace.slug} />
                <button
                  type="submit"
                  className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold uppercase text-primary"
                  >
                    {workspace.name.trim().charAt(0) || '?'}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{workspace.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {ROLE_LABELS[workspace.role]}
                    </span>
                  </span>
                  {workspace.onboardingCompletedAt === null ? (
                    <Badge variant="warning" className="shrink-0">
                      Setup pending
                    </Badge>
                  ) : null}
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              </form>
            </li>
          ))}
        </ul>

        <Link
          href="/onboarding"
          className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden />
          Create another business
        </Link>
      </div>
    </PreWorkspaceShell>
  );
}
