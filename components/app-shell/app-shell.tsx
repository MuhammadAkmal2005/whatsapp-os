'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { NotificationBell } from '@/components/app-shell/notification-bell';
import { SidebarAccount } from '@/components/app-shell/sidebar-account';
import { SidebarFooterNav, SidebarNav } from '@/components/app-shell/sidebar-nav';
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
 * The signed-in workspace chrome.
 *
 * One panel on the left holds everything about *where you are and who you are* — the
 * wordmark, the business you are working in, the navigation, and the account. It sits a
 * step below the page rather than above it, so it frames the workspace by receding, and it
 * follows the theme rather than being ink in both. The content column then holds only
 * content, and starts at the very top of the viewport.
 *
 * There is deliberately no desktop top bar. The previous one was 64px tall and carried
 * nothing on the left, because the wordmark it held was hidden above `lg`; it was an
 * empty band above every screen in the product. Page titles and page actions belong to
 * `PageHeader` inside the content column, which is where a reader's eye already is.
 * Mobile keeps a compact bar, because there the sidebar is a drawer that needs a handle.
 *
 * Client-side only for the one thing that genuinely needs it — the open/closed state of
 * the mobile drawer. Everything it displays (user, role, workspaces) is resolved on the
 * server and passed in as plain data; the shell never fetches and never decides who the
 * caller is.
 */
export function AppShell({ user, role, current, workspaces, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Twelve nav links sit before the content in the DOM, which is a long way to tab
          past on every page. The link is visually hidden until focused. */}
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-card focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-overlay"
      >
        Skip to content
      </a>

      {/* Desktop sidebar. Sticky and viewport-tall so the account row stays reachable on
          a long page instead of being pushed below the fold with the content. */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <SidebarBody role={role} current={current} workspaces={workspaces} user={user} />
      </aside>

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-fast lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[17.5rem] max-w-[calc(100vw-3rem)] flex-col bg-sidebar text-sidebar-foreground shadow-overlay duration-moderate ease-out focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left lg:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <SidebarBody
              role={role}
              current={current}
              workspaces={workspaces}
              user={user}
              onNavigate={() => setMobileOpen(false)}
              trailing={
                <Dialog.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close navigation"
                    className="text-sidebar-foreground hover:bg-sidebar-selected hover:text-sidebar-foreground"
                  >
                    <X aria-hidden />
                  </Button>
                </Dialog.Close>
              }
            />
          </Dialog.Content>
        </Dialog.Portal>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile only. Opaque rather than translucent-and-blurred: a blur over
              scrolling text is expensive to composite on a mid-range phone and makes the
              text behind it legible-but-smeared, which is worse than either state. The
              sticky shadow already draws the hairline, so there is no border here. */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-1 bg-background px-2 shadow-sticky lg:hidden">
            <Dialog.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu aria-hidden />
              </Button>
            </Dialog.Trigger>

            <Link
              href="/dashboard"
              aria-label="ConvoNexa dashboard"
              className="inline-flex rounded-sm"
            >
              <Logo />
            </Link>

            <div className="ml-auto">
              <NotificationBell />
            </div>
          </header>

          {/* `--shell-inset` is the vertical space this chrome takes from the viewport: the
              mobile header plus this element's own padding, then just the padding once the
              header is gone at `lg`. A screen that has to fill the viewport exactly — the
              inbox — subtracts it instead of hard-coding a number that silently stops
              matching the moment this padding changes. */}
          <main
            id="main"
            className="flex-1 px-4 py-5 [--shell-inset:6rem] sm:px-6 lg:px-8 lg:py-8 lg:[--shell-inset:4rem]"
          >
            <div className="mx-auto w-full max-w-page">{children}</div>
          </main>
        </div>
      </Dialog.Root>
    </div>
  );
}

/**
 * The sidebar's contents, shared verbatim between the desktop rail and the mobile drawer
 * so the two can never drift. `onNavigate` lets the drawer close itself when a link is
 * followed; `trailing` is the drawer's close button.
 *
 * Three bands: a fixed header, a scrolling nav, and a fixed footer. Only the middle band
 * scrolls, so the business you are in and the account you are signed in as are always on
 * screen — both are things you check to reassure yourself, and a reassurance you have to
 * scroll for is not one.
 */
function SidebarBody({
  role,
  current,
  workspaces,
  user,
  onNavigate,
  trailing,
}: {
  role: WorkspaceRole;
  current: SwitcherWorkspace;
  workspaces: readonly SwitcherWorkspace[];
  user: ShellUser;
  onNavigate?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <Link
            href="/dashboard"
            onClick={onNavigate}
            aria-label="ConvoNexa dashboard"
            className="inline-flex rounded-sm"
          >
            <Logo tone="sidebar" wordmarkClassName="text-sidebar-foreground" />
          </Link>
          {trailing}
        </div>

        <WorkspaceSwitcher current={current} workspaces={workspaces} />
      </div>

      {/* Only this band scrolls. Nav rows are full-bleed so the active row's marker rail
          lands on the panel's own edge; the thin scrollbar sits over the rows' right
          padding rather than stealing width from the labels. */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1 scrollbar-thin">
        <SidebarNav role={role} onNavigate={onNavigate} />
      </div>

      <div className="border-t border-sidebar-border pt-1">
        <SidebarFooterNav role={role} onNavigate={onNavigate} />
        <div className="flex items-center gap-1 p-2">
          <SidebarAccount user={user} />
          {/* Desktop only. In the mobile drawer this band is inside a `lg:hidden` panel,
              so the bell here never shows — it lives in the mobile top bar instead, where
              it is reachable without opening the drawer. */}
          <div className="hidden lg:block">
            <NotificationBell tone="sidebar" />
          </div>
        </div>
      </div>
    </>
  );
}
