import {
  Bot,
  BookOpen,
  Building2,
  CreditCard,
  MessageSquare,
  Package,
  Plug,
  Shield,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { Permission } from '@/server/authz/permissions';

/**
 * The settings area's sections, in one place.
 *
 * Same contract as the main sidebar: each section names the permission that gates
 * it and whether it is built. A section the caller's role cannot use is not
 * rendered; a section that does not exist yet renders disabled with a reason
 * rather than as a link to an empty page.
 *
 * Order is deliberate — the things a shop owner touches while setting up come
 * first, and the ones they touch once a year come last.
 */

export type SettingsNavItem = {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly description: string;
  readonly permission: Permission;
  readonly available: boolean;
  readonly reason?: string;
};

const IN_PROGRESS = 'Being built — available in an upcoming update.';

export const SETTINGS_NAV: readonly SettingsNavItem[] = [
  {
    label: 'Business',
    href: '/settings/business',
    icon: Building2,
    description: 'Your business name, category and contact details.',
    permission: 'workspace:read',
    available: false,
    reason: IN_PROGRESS,
  },
  {
    label: 'Team',
    href: '/settings/team',
    icon: Users,
    description: 'Invite people and choose what each of them can do.',
    permission: 'member:read',
    available: true,
  },
  {
    label: 'WhatsApp',
    href: '/settings/whatsapp',
    icon: MessageSquare,
    description: 'Connect your WhatsApp Business number.',
    permission: 'whatsapp:read',
    available: true,
  },
  {
    label: 'AI agent',
    href: '/settings/agent',
    icon: Bot,
    description: 'How your AI employee talks and when it hands over to you.',
    permission: 'agent:read',
    available: false,
    reason: IN_PROGRESS,
  },
  {
    label: 'Knowledge',
    href: '/settings/knowledge',
    icon: BookOpen,
    description: 'Teach your AI about your business.',
    permission: 'knowledge:read',
    available: false,
    reason: IN_PROGRESS,
  },
  {
    label: 'Products',
    href: '/settings/products',
    icon: Package,
    description: 'Categories, stock alerts and delivery charges.',
    permission: 'product:read',
    available: false,
    reason: IN_PROGRESS,
  },
  {
    label: 'Automation',
    href: '/settings/automation',
    icon: Zap,
    description: 'Follow-ups and reminders that run on their own.',
    permission: 'automation:read',
    available: false,
    reason: IN_PROGRESS,
  },
  {
    label: 'Integrations',
    href: '/settings/integrations',
    icon: Plug,
    description: 'Connect the other tools your business uses.',
    permission: 'integration:read',
    available: false,
    reason: IN_PROGRESS,
  },
  {
    label: 'Billing',
    href: '/settings/billing',
    icon: CreditCard,
    description: 'Your plan, usage and invoices.',
    permission: 'subscription:read',
    available: true,
  },
  {
    label: 'Security',
    href: '/settings/security',
    icon: Shield,
    description: 'Sign-in, active sessions and the activity log.',
    permission: 'audit_log:read',
    available: false,
    reason: IN_PROGRESS,
  },
];

/**
 * Where `/settings` should land someone.
 *
 * The first section they can actually open, rather than a fixed path — a MANAGER
 * has no billing access and an AGENT has no team access, so a hard-coded
 * destination would send some roles to a page they cannot see.
 */
export function firstAvailableSettingsHref(
  holds: (permission: Permission) => boolean,
): string | null {
  const match = SETTINGS_NAV.find((item) => item.available && holds(item.permission));
  return match?.href ?? null;
}
