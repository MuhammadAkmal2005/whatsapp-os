'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  NAV_FOOTER_ITEMS,
  NAV_SECTIONS,
  isNavRowActive,
  type NavItem,
} from '@/components/app-shell/nav-config';
import {
  SETTINGS_ROOT_HREF,
  settingsDestinationForRole,
} from '@/components/app-shell/settings-nav-config';
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
 *
 * Rows are full-bleed rather than inset pills. That is what lets the active row carry the
 * marker rail on the panel's own edge, which is the product's one signature: a 2px rule on
 * the leading edge always means "this is the one". Pills floating inside a padded panel
 * would put the rail 12px adrift of the edge and lose that.
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
      <nav className="flex flex-col gap-4" aria-label="Main">
        {NAV_SECTIONS.map((section, index) => {
          const items = section.items.filter((item) => roleHasPermission(role, item.permission));
          if (items.length === 0) return null;

          return (
            <div key={section.label ?? `section-${index}`} className="flex flex-col gap-0.5">
              {section.label ? (
                <p className="eyebrow px-4 pb-1 text-sidebar-muted">{section.label}</p>
              ) : null}
              <ul className="flex flex-col">
                {items.map((item) => (
                  <li key={item.href}>
                    <NavRow
                      item={item}
                      href={destinationFor(item, role)}
                      pathname={pathname}
                      onNavigate={onNavigate}
                    />
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

/**
 * The footer links, rendered by the shell below the scrolling list. Same row treatment,
 * so Settings does not look like a different kind of thing than Orders.
 */
export function SidebarFooterNav({
  role,
  onNavigate,
}: {
  role: WorkspaceRole;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = NAV_FOOTER_ITEMS.filter((item) => roleHasPermission(role, item.permission));
  if (items.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <ul className="flex flex-col" aria-label="Workspace settings">
        {items.map((item) => (
          <li key={item.href}>
            <NavRow
              item={item}
              href={destinationFor(item, role)}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
}

/**
 * Where a row should actually send the reader.
 *
 * Every row goes to its own path except Settings. `/settings` has no screen — it works out the
 * first section the role can open and redirects there — so clicking it used to cost two
 * navigations: a server round trip whose entire output was "go here instead", and then the real
 * one. Pointing the row at the section directly removes the first, and lets Next prefetch
 * something useful instead of prefetching a redirect.
 *
 * The destination comes from the settings registry's own resolver, which the page's redirect is
 * built on too, so the two cannot choose differently. Nothing here decides access — the sections
 * all check again server-side.
 */
function destinationFor(item: NavItem, role: WorkspaceRole): string {
  return item.href === SETTINGS_ROOT_HREF ? settingsDestinationForRole(role) : item.href;
}

const rowStyles =
  'flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-instant ease-out [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * `href` is where the row goes; `item.href` is what makes it look active. They differ only for
 * Settings, where the row must stay lit on `/settings/team` and `/settings/billing` alike — so
 * the active test keeps matching the section root while the link skips the redirect.
 */
function NavRow({
  item,
  href,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  href: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  if (!item.available) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span aria-disabled className={cn(rowStyles, 'cursor-default select-none text-sidebar-muted')}>
            <Icon aria-hidden />
            <span className="flex-1">{item.label}</span>
            <span className="eyebrow rounded-xs border border-sidebar-border px-1 py-px text-sidebar-muted">
              Soon
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{item.reason}</TooltipContent>
      </Tooltip>
    );
  }

  const active = isNavRowActive(pathname, item.href);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        rowStyles,
        active
          ? 'marker-rail-sidebar bg-sidebar-selected font-medium text-sidebar-foreground'
          : 'text-sidebar-foreground/75 hover:bg-sidebar-selected/60 hover:text-sidebar-foreground',
      )}
    >
      <Icon aria-hidden className={active ? 'text-sidebar-primary' : undefined} />
      <span>{item.label}</span>
    </Link>
  );
}
