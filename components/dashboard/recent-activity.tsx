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
import { EmptyState } from '@/components/ui/empty-state';
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
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="New orders, customer messages and changes to your catalogue show up here as they happen."
            size="compact"
            variant="plain"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {entries.map((entry) => {
              const Icon = iconFor(entry.action);
              return (
                <li key={entry.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  {/* The icon sits bare rather than in a filled disc. A feed is a column of
                      identically-sized tiles, so a disc behind each one turns the left edge into
                      a strip of grey blobs and makes every row taller than the text needs. */}
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />

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
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
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
