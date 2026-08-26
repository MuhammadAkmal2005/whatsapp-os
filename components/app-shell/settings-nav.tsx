'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SETTINGS_NAV, type SettingsNavItem } from '@/components/app-shell/settings-nav-config';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { roleHasPermission, type WorkspaceRole } from '@/server/authz/permissions';
import { cn } from '@/lib/utils';

/**
 * The settings area's section list.
 *
 * A client component because it needs `usePathname` to mark the current section,
 * and because a Server Component cannot pass icon components across the boundary.
 * It takes only the role — the one serialisable fact needed to decide what to show
 * — and every section it links to re-checks that permission on the server.
 *
 * Horizontally scrollable on mobile, a vertical rail from `lg` up. A settings area
 * that needs a hamburger inside a hamburger is a settings area nobody opens on a
 * phone, and a shop owner does most things on a phone.
 */
export function SettingsNav({ role }: { role: WorkspaceRole }) {
  const pathname = usePathname();
  const items = SETTINGS_NAV.filter((item) => roleHasPermission(role, item.permission));

  return (
    <TooltipProvider delayDuration={200}>
      <nav aria-label="Settings sections">
        <ul
          className={cn(
            'flex gap-1 overflow-x-auto pb-2 -mx-1 px-1',
            'lg:mx-0 lg:flex-col lg:overflow-visible lg:pb-0 lg:px-0',
          )}
        >
          {items.map((item) => (
            <li key={item.href} className="shrink-0 lg:shrink">
              <SettingsNavRow item={item} pathname={pathname} />
            </li>
          ))}
        </ul>
      </nav>
    </TooltipProvider>
  );
}

const rowStyles =
  'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0 lg:w-full';

function SettingsNavRow({ item, pathname }: { item: SettingsNavItem; pathname: string }) {
  const Icon = item.icon;

  if (!item.available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-disabled
            className={cn(rowStyles, 'cursor-not-allowed select-none text-muted-foreground/50')}
          >
            <Icon aria-hidden />
            <span className="flex-1">{item.label}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Soon
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{item.reason}</TooltipContent>
      </Tooltip>
    );
  }

  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        rowStyles,
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <Icon aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}
