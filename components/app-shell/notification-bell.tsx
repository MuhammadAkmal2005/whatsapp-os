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
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  getNotificationOverviewAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationItemDTO,
} from '@/server/actions/notification.actions';

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItemDTO[]>([]);
  const [isPending, startTransition] = useTransition();

  const fetchOverview = async () => {
    try {
      const overview = await getNotificationOverviewAction();
      setUnreadCount(overview.unreadCount);
      setNotifications(overview.notifications);
    } catch {
      // Ignore background fetch error
    }
  };

  useEffect(() => {
    fetchOverview();
    // Poll every 30 seconds for background updates
    const interval = setInterval(fetchOverview, 30000);
    return () => clearInterval(interval);
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
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() })),
      );
      setUnreadCount(0);
    });
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-foreground hover:bg-accent"
          aria-label={`Notifications (${unreadCount} unread)`}
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between border-b border-border p-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-3xs">
                {unreadCount} new
              </Badge>
            )}
          </div>

          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={isPending}
              className="h-auto p-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="mr-1 size-3.5" />
              Mark all as read
            </Button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-border">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
              <Bell className="size-6 text-muted-foreground/40 mb-2" />
              No notifications yet
            </div>
          ) : (
            notifications.map((n) => {
              const isUnread = !n.readAt;
              const link = getResourceLink(n.resourceType, n.resourceId);

              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 p-3 transition-colors ${
                    isUnread ? 'bg-primary/5' : 'hover:bg-accent/40'
                  }`}
                >
                  <NotificationIcon type={n.type} level={n.level} />

                  <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      {link ? (
                        <Link
                          href={link}
                          onClick={() => {
                            if (isUnread) handleMarkRead(n.id);
                            setIsOpen(false);
                          }}
                          className="text-xs font-semibold text-foreground hover:underline line-clamp-1"
                        >
                          {n.title}
                        </Link>
                      ) : (
                        <span className="text-xs font-semibold text-foreground line-clamp-1">
                          {n.title}
                        </span>
                      )}
                      <span className="text-3xs text-muted-foreground whitespace-nowrap">
                        {formatTimeAgo(n.createdAt)}
                      </span>
                    </div>

                    {n.body && (
                      <p className="text-2xs text-muted-foreground line-clamp-2">
                        {n.body}
                      </p>
                    )}
                  </div>

                  {isUnread && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleMarkRead(n.id)}
                      disabled={isPending}
                      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                      title="Mark as read"
                    >
                      <Check className="size-3" />
                    </Button>
                  )}
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
      return `/conversations`;
    case 'Order':
      return `/orders/${resourceId}`;
    case 'Product':
      return `/products/${resourceId}`;
    case 'Contact':
      return `/contacts/${resourceId}`;
    case 'Automation':
    case 'AutomationRun':
      return `/automations`;
    default:
      return null;
  }
}

function NotificationIcon({ type, level }: { type: string; level: string }) {
  if (type === 'HUMAN_HANDOFF' || level === 'WARNING' || level === 'ERROR') {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
        <AlertTriangle className="size-3.5" />
      </div>
    );
  }
  if (type === 'NEW_ORDER' || type === 'ORDER_STATUS_CHANGED') {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
        <ShoppingBag className="size-3.5" />
      </div>
    );
  }
  if (type === 'LOW_STOCK') {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
        <Package className="size-3.5" />
      </div>
    );
  }
  if (type === 'AI_FAILURE') {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <Bot className="size-3.5" />
      </div>
    );
  }
  if (type === 'NEW_LEAD') {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
        <User className="size-3.5" />
      </div>
    );
  }

  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Zap className="size-3.5" />
    </div>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
