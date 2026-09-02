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
            // The -mx-1/px-1 pair gives the focus outline room to breathe inside the
            // scroll container, which would otherwise clip it on the first and last chip.
            'flex gap-1 overflow-x-auto -mx-1 px-1 pb-2 scrollbar-none',
            'lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0',
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

const rowStyles = cn(
  'flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm',
  'transition-colors duration-instant ease-out [&_svg]:size-4 [&_svg]:shrink-0',
  // A vertical rail from lg up, so the active section can carry the marker rail on its
  // leading edge. The left corners square off there or the 2px rail would be clipped by
  // the radius; on the mobile strip the rows stay fully rounded chips.
  'lg:w-full lg:rounded-l-none',
);

function SettingsNavRow({ item, pathname }: { item: SettingsNavItem; pathname: string }) {
  const Icon = item.icon;

  if (!item.available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-disabled
            className={cn(rowStyles, 'cursor-default select-none text-muted-foreground')}
          >
            <Icon aria-hidden />
            <span className="flex-1">{item.label}</span>
            <span className="eyebrow rounded-xs border border-border px-1 py-px">Soon</span>
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
          ? 'bg-surface-selected font-medium text-foreground lg:marker-rail'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon aria-hidden className={active ? 'text-primary' : undefined} />
      <span>{item.label}</span>
    </Link>
  );
}
