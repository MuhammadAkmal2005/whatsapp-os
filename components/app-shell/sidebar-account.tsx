'use client';

import { Check, ChevronsUpDown, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, useTransition } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { logoutAction } from '@/server/actions/auth.actions';
import { initials } from '@/lib/names';
import { cn } from '@/lib/utils';

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match my device', icon: Monitor },
] as const;

/**
 * The account row pinned to the bottom of the sidebar.
 *
 * It carries the appearance setting as well as sign-out, rather than leaving a separate
 * theme button in the chrome. Appearance is a preference of *this person*, set once and
 * rarely revisited, so it belongs behind their own name — not beside the navigation it
 * has nothing to do with. That also removes an icon from the shell, which is the point:
 * a control used twice a year should not hold permanent space.
 *
 * Sign out calls `logoutAction` directly — it revokes the session server-side and then
 * redirects — so the session is actually killed in the database, not merely forgotten in
 * the browser. Called with no arguments here: its optional form data only carries a
 * pending invitation, which this menu never has.
 */
export function SidebarAccount({
  user,
}: {
  user: { name: string; email: string; avatarUrl: string | null };
}) {
  const [isPending, startTransition] = useTransition();
  const { theme, setTheme } = useTheme();

  // next-themes resolves on the client, so the active choice is unknown during SSR.
  // Rendering the tick before mount would mismatch the server's markup.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function signOut() {
    startTransition(() => {
      void logoutAction();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
          'transition-colors duration-instant ease-out hover:bg-sidebar-selected',
          isPending && 'pointer-events-none opacity-60',
        )}
        aria-label="Your account"
      >
        <Avatar className="size-7 shrink-0">
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
          <AvatarFallback className="bg-sidebar-accent text-3xs text-sidebar-foreground">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium text-sidebar-foreground">{user.name}</span>
          <span className="truncate text-3xs text-sidebar-muted">{user.email}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-muted" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5 text-foreground">
          <span className="truncate text-sm font-medium">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        {THEMES.map((option) => {
          const active = mounted && theme === option.value;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => setTheme(option.value)}
              className={cn(active && 'font-medium text-foreground')}
            >
              <option.icon className="size-4" aria-hidden />
              <span className="flex-1">{option.label}</span>
              {active ? <Check className="size-4 text-primary" aria-hidden /> : null}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={signOut}>
          <LogOut className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
