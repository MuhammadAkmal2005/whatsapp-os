import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Package,
  ShoppingBag,
  Bot,
  BookOpen,
  Zap,
  Megaphone,
  CalendarClock,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';

import type { Permission } from '@/server/authz/permissions';

import { SETTINGS_NAV } from './settings-nav-config';

/**
 * The dashboard's information architecture, in one place.
 *
 * Each item carries the permission that gates it and whether the feature ships
 * yet. The sidebar renders a permitted-and-available item as a link, and a
 * permitted-but-not-yet-available item as a disabled row with a reason — the
 * product map is visible from day one, and each phase turns an item on by
 * flipping `available` (and adding its route). An item the caller's role cannot
 * use is not rendered at all; unavailability is about the build, not a teaser
 * for capabilities a viewer will never hold.
 *
 * Routing is cookie-based: the active workspace lives in a cookie, so these are
 * flat paths (`/orders`, not `/[slug]/orders`) resolved by the `(workspace)`
 * layout.
 */

export type NavItem = {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly permission: Permission;
  /** False until the feature is built; drives the disabled state in the sidebar. */
  readonly available: boolean;
  /** Shown as a tooltip when the item is unavailable. Honest, never "coming soon". */
  readonly reason?: string;
};

export type NavSection = {
  /** `null` for the section that opens the nav, which needs no heading. */
  readonly label: string | null;
  readonly items: readonly NavItem[];
};

/**
 * Shared reason for the features that are designed and routed but not yet built
 * in the current phase. Deliberately not "coming soon": it states the truth
 * (the area is being built) without promising a date.
 */
const IN_PROGRESS = 'Being built — available in an upcoming update.';

/**
 * Four groups, not six. Section headings are navigation furniture, not content: at six
 * headings for nine live destinations the sidebar spent more height on labels than on
 * links, and Settings fell below the fold on a laptop. Dashboard now opens the list
 * without a heading of its own, and Settings is pinned to the sidebar footer where every
 * tool this audience already uses keeps it.
 *
 * The order follows the shop owner's day rather than the org chart: the messages waiting
 * for them, then the people and things they sell, then the machinery that does it for
 * them, then the numbers.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: null,
    items: [
      {
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        permission: 'analytics:read',
        available: true,
      },
      {
        label: 'Conversations',
        href: '/conversations',
        icon: MessageSquare,
        permission: 'conversation:read',
        available: true,
      },
    ],
  },
  {
    label: 'Sell',
    items: [
      {
        label: 'Customers',
        href: '/contacts',
        icon: Users,
        permission: 'contact:read',
        available: true,
      },
      {
        label: 'Products',
        href: '/products',
        icon: Package,
        permission: 'product:read',
        available: true,
      },
      {
        label: 'Orders',
        href: '/orders',
        icon: ShoppingBag,
        permission: 'order:read',
        available: true,
      },
    ],
  },
  {
    label: 'Automate',
    items: [
      {
        label: 'Automations',
        href: '/automations',
        icon: Zap,
        permission: 'automation:read',
        available: true,
      },
      {
        label: 'AI Agent',
        href: '/agent',
        icon: Bot,
        permission: 'agent:read',
        available: false,
        reason: IN_PROGRESS,
      },
      {
        label: 'Knowledge',
        href: '/knowledge',
        icon: BookOpen,
        permission: 'knowledge:read',
        available: false,
        reason: IN_PROGRESS,
      },
    ],
  },
  {
    label: 'Grow',
    items: [
      {
        label: 'Analytics',
        href: '/analytics',
        icon: BarChart3,
        permission: 'analytics:read',
        available: true,
      },
      {
        label: 'Campaigns',
        href: '/campaigns',
        icon: Megaphone,
        permission: 'campaign:read',
        available: false,
        reason: IN_PROGRESS,
      },
      {
        label: 'Appointments',
        href: '/appointments',
        icon: CalendarClock,
        permission: 'appointment:read',
        available: false,
        reason: IN_PROGRESS,
      },
    ],
  },
];

/**
 * Rendered in the sidebar footer rather than in the scrolling list. Settings is reached
 * occasionally and from anywhere, so it should never move or scroll out of reach.
 */
export const NAV_FOOTER_ITEMS: readonly NavItem[] = [
  {
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    permission: 'workspace:read',
    available: true,
  },
];

/**
 * Whether a path is a destination that exists and is built today.
 *
 * The two nav registries already record this for every screen in the product, so anything
 * else that needs to know — the setup checklist, a hint that links somewhere — asks here
 * rather than keeping its own list. The checklist used to keep one, and it had gone stale:
 * it still believed `/products` and `/settings/whatsapp` were unbuilt long after they
 * shipped, so every step on the dashboard's own onboarding card rendered as inert.
 *
 * Unknown paths answer `false`. Failing closed means a mistyped href renders as an
 * unavailable step rather than as a link to a 404.
 */
export function isNavDestinationAvailable(href: string): boolean {
  const match = [...NAV_SECTIONS.flatMap((section) => section.items), ...NAV_FOOTER_ITEMS].find(
    (item) => item.href === href,
  );

  if (match) return match.available;

  return SETTINGS_NAV.find((item) => item.href === href)?.available ?? false;
}
