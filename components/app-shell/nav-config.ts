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
  readonly label: string;
  readonly items: readonly NavItem[];
};

/**
 * Shared reason for the features that are designed and routed but not yet built
 * in the current phase. Deliberately not "coming soon": it states the truth
 * (the area is being built) without promising a date.
 */
const IN_PROGRESS = 'Being built — available in an upcoming update.';

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: 'Overview',
    items: [
      {
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        permission: 'analytics:read',
        available: true,
      },
    ],
  },
  {
    label: 'Inbox',
    items: [
      {
        label: 'Conversations',
        href: '/conversations',
        icon: MessageSquare,
        permission: 'conversation:read',
        available: false,
        reason: IN_PROGRESS,
      },
      {
        label: 'Customers',
        href: '/contacts',
        icon: Users,
        permission: 'contact:read',
        available: false,
        reason: IN_PROGRESS,
      },
    ],
  },
  {
    label: 'Commerce',
    items: [
      {
        label: 'Products',
        href: '/products',
        icon: Package,
        permission: 'product:read',
        available: false,
        reason: IN_PROGRESS,
      },
      {
        label: 'Orders',
        href: '/orders',
        icon: ShoppingBag,
        permission: 'order:read',
        available: false,
        reason: IN_PROGRESS,
      },
    ],
  },
  {
    label: 'AI',
    items: [
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
        label: 'Automations',
        href: '/automations',
        icon: Zap,
        permission: 'automation:read',
        available: false,
        reason: IN_PROGRESS,
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
      {
        label: 'Analytics',
        href: '/analytics',
        icon: BarChart3,
        permission: 'analytics:read',
        available: false,
        reason: IN_PROGRESS,
      },
    ],
  },
  {
    label: 'Manage',
    items: [
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        permission: 'workspace:read',
        available: true,
      },
    ],
  },
];
