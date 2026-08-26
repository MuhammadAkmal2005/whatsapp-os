'use client';

import { LogOut } from 'lucide-react';
import { useTransition } from 'react';

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
import { cn } from '@/lib/utils';

/** Initials for the avatar fallback: first letters of the first two words. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.charAt(0) ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + second).toUpperCase();
}

/**
 * The signed-in user's avatar and account menu.
 *
 * Sign out calls `logoutAction` directly — it revokes the session server-side and
 * then redirects — so the session is actually killed in the database, not merely
 * forgotten in the browser. Called with no arguments here: its optional form data
 * only carries a pending invitation, which this menu never has.
 */
export function UserMenu({
  user,
}: {
  user: { name: string; email: string; avatarUrl: string | null };
}) {
  const [isPending, startTransition] = useTransition();

  function signOut() {
    startTransition(() => {
      void logoutAction();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isPending && 'pointer-events-none opacity-70',
        )}
        aria-label="Account menu"
      >
        <Avatar className="size-9">
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2 text-foreground">
          <span className="truncate text-sm font-medium">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={signOut}>
          <LogOut className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
