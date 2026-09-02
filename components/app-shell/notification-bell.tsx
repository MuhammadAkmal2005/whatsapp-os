'use client';

import { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import {
  Bell,
  Check,
  CheckCheck,
  AlertTriangle,
  ShoppingBag,
  User,
  Zap,
  Package,
  Bot,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  getNotificationOverviewAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationItemDTO,
} from '@/server/actions/notification.actions';

/** How often the badge count refreshes while the tab is open. */
const POLL_INTERVAL_MS = 30_000;

/**
 * The notification bell and its list.
 *
 * `tone` exists because the bell lives in two places with opposite grounds: the ink
 * sidebar at desktop widths and the paper mobile bar. The panel itself is portaled onto
 * the popover surface either way, so only the trigger changes.
 */
export function NotificationBell({ tone = 'default' }: { tone?: 'default' | 'sidebar' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItemDTO[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const overview = await getNotificationOverviewAction();
        if (!active) return;
        setUnreadCount(overview.unreadCount);
        setNotifications(overview.notifications);
        setLoadFailed(false);
      } catch {
        // A background poll must not raise a toast on every dropped request — that would
        // punish a weak connection with a stream of alerts. But it must not silently show
        // "nothing to see" either, so the panel says so when opened.
        if (active) setLoadFailed(true);
      }
    }

    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleMarkRead = (id: string) => {
    startTransition(async () => {
      await markNotificationReadAction(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    });
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
      setUnreadCount(0);
    });
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'relative',
            tone === 'sidebar' &&
              'text-sidebar-foreground hover:bg-sidebar-selected hover:text-sidebar-foreground',
          )}
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications, none unread'
          }
        >
          <Bell aria-hidden />
          {unreadCount > 0 ? (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-3xs font-semibold tabular-nums text-primary-foreground"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" side="top" className="w-[20rem] p-0 sm:w-[22rem]">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
            {unreadCount > 0 ? <Badge variant="secondary">{unreadCount} new</Badge> : null}
          </div>

          {unreadCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={handleMarkAllRead} disabled={isPending}>
              <CheckCheck aria-hidden />
              Mark all read
            </Button>
          ) : null}
        </div>

        <div className="max-h-[22rem] divide-y divide-border overflow-y-auto scrollbar-thin">
          {loadFailed && notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              Could not load your notifications. Checking again shortly.
            </p>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <Bell className="size-5 text-muted-foreground/50" aria-hidden />
              <p className="text-sm font-medium text-foreground">Nothing needs you right now</p>
              <p className="text-xs text-muted-foreground">
                New orders, handoffs and low stock will show up here.
              </p>
            </div>
          ) : (
            notifications.map((n) => {
              const isUnread = !n.readAt;
              const link = getResourceLink(n.resourceType, n.resourceId);

              return (
                <div
                  key={n.id}
                  className={cn(
                    'flex items-start gap-2.5 px-3 py-2.5 transition-colors duration-instant ease-out',
                    isUnread ? 'marker-rail bg-surface-selected' : 'hover:bg-muted',
                  )}
                >
                  <NotificationIcon type={n.type} level={n.level} />

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      {link ? (
                        <Link
                          href={link}
                          onClick={() => {
                            if (isUnread) handleMarkRead(n.id);
                            setIsOpen(false);
                          }}
                          className="line-clamp-1 rounded-xs text-xs font-semibold text-foreground hover:underline"
                        >
                          {n.title}
                        </Link>
                      ) : (
                        <span className="line-clamp-1 text-xs font-semibold text-foreground">
                          {n.title}
                        </span>
                      )}
                      <span className="shrink-0 text-3xs tabular-nums text-muted-foreground">
                        {formatTimeAgo(n.createdAt)}
                      </span>
                    </div>

                    {n.body ? (
                      <p className="line-clamp-2 text-2xs text-muted-foreground">{n.body}</p>
                    ) : null}
                  </div>

                  {isUnread ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleMarkRead(n.id)}
                      disabled={isPending}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={`Mark "${n.title}" as read`}
                    >
                      <Check className="size-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getResourceLink(resourceType?: string | null, resourceId?: string | null): string | null {
  if (!resourceType || !resourceId) return null;
  switch (resourceType) {
    case 'Conversation':
      return '/conversations';
    case 'Order':
      return `/orders/${resourceId}`;
    case 'Product':
      return `/products/${resourceId}`;
    case 'Contact':
      return `/contacts/${resourceId}`;
    case 'Automation':
    case 'AutomationRun':
      return '/automations';
    default:
      return null;
  }
}

type IconTone = 'warning' | 'destructive' | 'success' | 'info' | 'primary';

const TONE_CLASSES: Record<IconTone, string> = {
  warning: 'bg-warning-surface text-warning',
  destructive: 'bg-destructive-surface text-destructive',
  success: 'bg-success-surface text-success',
  info: 'bg-info-surface text-info',
  primary: 'bg-primary-surface text-primary',
};

/**
 * Maps a notification to its mark. Deliberately semantic rather than palette-based: the
 * previous version reached for `bg-amber-500/10` and friends, which are tuned for a light
 * page and turn muddy on an ink one.
 */
function resolveMark(type: string, level: string): { icon: LucideIcon; tone: IconTone } {
  if (level === 'ERROR' || type === 'AI_FAILURE') return { icon: Bot, tone: 'destructive' };
  if (type === 'HUMAN_HANDOFF') return { icon: AlertTriangle, tone: 'warning' };
  if (type === 'LOW_STOCK') return { icon: Package, tone: 'warning' };
  if (type === 'NEW_ORDER' || type === 'ORDER_STATUS_CHANGED')
    return { icon: ShoppingBag, tone: 'success' };
  if (type === 'NEW_LEAD') return { icon: User, tone: 'info' };
  if (level === 'WARNING') return { icon: AlertTriangle, tone: 'warning' };
  return { icon: Zap, tone: 'primary' };
}

function NotificationIcon({ type, level }: { type: string; level: string }) {
  const { icon: Icon, tone } = resolveMark(type, level);
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md',
        TONE_CLASSES[tone],
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
