'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NAV_SECTIONS, type NavItem } from '@/components/app-shell/nav-config';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { roleHasPermission, type WorkspaceRole } from '@/server/authz/permissions';
import { cn } from '@/lib/utils';

/**
 * The workspace sidebar's link list.
 *
 * A Server Component cannot hand a client one an icon *component* as a prop
 * (functions do not cross the boundary), so this owns `NAV_SECTIONS` directly
 * and takes only the caller's role — the one serialisable fact it needs to
 * decide visibility. Permission gating runs here for the affordance and again in
 * every service for the actual control; hiding a link is never the security
 * boundary.
 */
export function SidebarNav({
  role,
  onNavigate,
}: {
  role: WorkspaceRole;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={200}>
      <nav className="flex flex-col gap-5" aria-label="Main">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => roleHasPermission(role, item.permission));
          if (items.length === 0) return null;

          return (
            <div key={section.label} className="flex flex-col gap-1">
              <p className="px-3 text-2xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
                {section.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <NavRow item={item} pathname={pathname} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const rowStyles =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0';

function NavRow({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  if (!item.available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-disabled
            className={cn(
              rowStyles,
              'cursor-not-allowed text-sidebar-foreground/40 select-none',
            )}
          >
            <Icon aria-hidden />
            <span className="flex-1">{item.label}</span>
            <span className="rounded bg-sidebar-foreground/10 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-sidebar-foreground/50">
              Soon
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{item.reason}</TooltipContent>
      </Tooltip>
    );
  }

  const active = isActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        rowStyles,
        active
          ? 'bg-sidebar-accent text-sidebar-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      )}
    >
      <Icon aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}
