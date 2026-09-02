'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useTransition } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { switchWorkspaceAction } from '@/server/actions/workspace.actions';
import { cn } from '@/lib/utils';

export type SwitcherWorkspace = {
  id: string;
  slug: string;
  name: string;
};

/**
 * Switches the active workspace from inside the shell.
 *
 * Selecting a workspace calls `switchWorkspaceAction` directly with a small
 * `FormData` — the action re-verifies membership server-side before it writes
 * the active-workspace cookie and redirects, so the slug carried here is a
 * request, never a grant. The programmatic call (rather than a form per row)
 * avoids the portaled menu closing out from under a nested submit.
 */
export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: SwitcherWorkspace;
  workspaces: readonly SwitcherWorkspace[];
}) {
  const [isPending, startTransition] = useTransition();

  function switchTo(slug: string) {
    if (slug === current.slug) return;
    const formData = new FormData();
    formData.set('slug', slug);
    startTransition(() => {
      void switchWorkspaceAction(formData);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md border border-sidebar-border bg-sidebar-accent p-1.5 text-left',
          'transition-colors duration-instant ease-out hover:bg-sidebar-selected',
          isPending && 'pointer-events-none opacity-60',
        )}
        aria-label={`Current business: ${current.name}. Switch business.`}
      >
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-sidebar text-xs font-semibold uppercase text-sidebar-primary"
        >
          {current.name.trim().charAt(0) || '?'}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-sidebar-foreground">
            {current.name}
          </span>
          <span className="eyebrow text-sidebar-muted">
            {workspaces.length > 1 ? `${workspaces.length} businesses` : 'Business'}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-muted" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Your businesses</DropdownMenuLabel>
        {workspaces.map((workspace) => {
          const isCurrent = workspace.slug === current.slug;
          return (
            <DropdownMenuItem
              key={workspace.id}
              onSelect={() => switchTo(workspace.slug)}
              className={cn(isCurrent && 'font-medium')}
            >
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-muted text-3xs font-semibold uppercase text-muted-foreground"
              >
                {workspace.name.trim().charAt(0) || '?'}
              </span>
              <span className="flex-1 truncate">{workspace.name}</span>
              {isCurrent ? <Check className="size-4 text-primary" aria-hidden /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {/* A menu item that navigates rather than switches: onboarding provisions a
            brand-new workspace. Kept as an <a> via asChild so it is a real link. */}
        <DropdownMenuItem asChild>
          <a href="/onboarding">
            <Plus className="size-4" aria-hidden />
            Create another business
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
