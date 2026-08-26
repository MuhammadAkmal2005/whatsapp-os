import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  MessageSquare,
  Package,
  ShoppingBag,
  Sparkles,
  Store,
  UserRound,
  Wallet,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/datetime';
import type { ActivityEntry } from '@/server/repositories/metrics.repository';

/**
 * Friendly labels for the actions we already emit. Anything not listed is
 * humanised from its `resource.verb` code, so a newer action reads sensibly
 * ("product.created" → "Product created") without needing an entry here.
 */
const ACTION_LABELS: Record<string, string> = {
  'workspace.created': 'Business created',
  'user.signup': 'Account created',
  'user.login': 'Signed in',
  'user.logout': 'Signed out',
};

const RESOURCE_ICONS: Record<string, LucideIcon> = {
  workspace: Store,
  user: UserRound,
  contact: UserRound,
  product: Package,
  order: ShoppingBag,
  conversation: MessageSquare,
  message: MessageSquare,
  payment: Wallet,
  ai: Sparkles,
};

/** Who acted, in shop-owner words rather than the enum. */
const ACTOR_LABELS: Record<string, string> = {
  USER: 'Team member',
  AI_AGENT: 'AI assistant',
  SYSTEM: 'System',
  AUTOMATION: 'Automation',
  CUSTOMER: 'Customer',
};

function humanizeAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const label = action.replace(/[._]/g, ' ').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function iconFor(action: string): LucideIcon {
  const prefix = (action.split('.')[0] ?? '').toLowerCase();
  return RESOURCE_ICONS[prefix] ?? Activity;
}

/**
 * The workspace activity feed, read from the audit log. Server-rendered, so the
 * relative timestamps are computed once against `now` and shipped as text — no
 * client clock, no hydration drift. Empty is a first-class state: a new
 * workspace explains what will appear rather than showing a blank card.
 */
export function RecentActivity({
  entries,
  now = new Date(),
}: {
  entries: ActivityEntry[];
  now?: Date;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No activity yet. New orders, customer messages and changes to your catalogue will show
            up here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {entries.map((entry) => {
              const Icon = iconFor(entry.action);
              return (
                <li key={entry.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {humanizeAction(entry.action)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ACTOR_LABELS[entry.actorType] ?? entry.actorType}
                    </span>
                  </div>
                  <time
                    dateTime={entry.createdAt.toISOString()}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {formatRelativeTime(entry.createdAt, now)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
