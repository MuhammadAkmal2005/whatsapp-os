'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { NotificationBell } from '@/components/app-shell/notification-bell';
import { SidebarNav } from '@/components/app-shell/sidebar-nav';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { UserMenu } from '@/components/app-shell/user-menu';
import { WorkspaceSwitcher, type SwitcherWorkspace } from '@/components/app-shell/workspace-switcher';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import type { WorkspaceRole } from '@/server/authz/permissions';

type ShellUser = { name: string; email: string; avatarUrl: string | null };

type AppShellProps = {
  user: ShellUser;
  role: WorkspaceRole;
  current: SwitcherWorkspace;
  workspaces: readonly SwitcherWorkspace[];
  children: React.ReactNode;
};

/**
 * The signed-in workspace chrome: a dark sidebar on the left at desktop widths,
 * a slide-over of the same content on mobile, and a sticky top bar carrying the
 * account menu and theme switch.
 *
 * Client-side only for the one thing that genuinely needs it — the open/closed
 * state of the mobile drawer. Everything it displays (user, role, workspaces)
 * is resolved on the server and passed in as plain data; the shell never fetches
 * and never decides who the caller is.
 */
export function AppShell({ user, role, current, workspaces, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground lg:flex">
        <SidebarBody
          role={role}
          current={current}
          workspaces={workspaces}
        />
      </aside>

      {/* Mobile slide-over */}
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left lg:hidden">
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <SidebarBody
              role={role}
              current={current}
              workspaces={workspaces}
              onNavigate={() => setMobileOpen(false)}
              trailing={
                <Dialog.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close menu"
                    className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  >
                    <X className="size-5" />
                  </Button>
                </Dialog.Close>
              }
            />
          </Dialog.Content>
        </Dialog.Portal>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
            <Dialog.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="lg:hidden">
                <Menu className="size-5" />
              </Button>
            </Dialog.Trigger>

            <Link href="/dashboard" aria-label="Dashboard" className="lg:hidden">
              <Logo />
            </Link>

            <div className="ml-auto flex items-center gap-1.5">
              <NotificationBell />
              <ThemeToggle />
              <UserMenu user={user} />
            </div>
          </header>

          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </Dialog.Root>
    </div>
  );
}

/**
 * The sidebar's contents, shared verbatim between the desktop rail and the
 * mobile drawer so the two can never drift. `onNavigate` lets the drawer close
 * itself when a link is followed; `trailing` is the drawer's close button.
 */
function SidebarBody({
  role,
  current,
  workspaces,
  onNavigate,
  trailing,
}: {
  role: WorkspaceRole;
  current: SwitcherWorkspace;
  workspaces: readonly SwitcherWorkspace[];
  onNavigate?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Link href="/dashboard" onClick={onNavigate} aria-label="Dashboard" className="inline-flex">
          <Logo wordmarkClassName="text-sidebar-foreground" />
        </Link>
        {trailing}
      </div>

      <WorkspaceSwitcher current={current} workspaces={workspaces} />

      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        <SidebarNav role={role} onNavigate={onNavigate} />
      </div>
    </>
  );
}
