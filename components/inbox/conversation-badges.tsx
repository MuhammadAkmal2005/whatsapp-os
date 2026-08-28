/**
 * Badges, icons, and formatters for the Inbox UI.
 *
 * Provides consistent visual representation for conversation statuses, priorities,
 * channels, AI automation states, and message delivery statuses across the inbox.
 */

import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Mail,
  MessageCircle,
  MessageSquare,
  Smartphone,
  UserCheck,
} from 'lucide-react';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import type {
  Channel,
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  Priority,
} from '@/server/validation/conversation';

// ── Status Badges ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: 'Open',
  PENDING: 'Pending',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const STATUS_VARIANT: Record<ConversationStatus, BadgeProps['variant']> = {
  OPEN: 'default',
  PENDING: 'warning',
  RESOLVED: 'success',
  CLOSED: 'muted',
};

export function ConversationStatusBadge({
  status,
  className,
}: {
  status: ConversationStatus;
  className?: string;
}) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

// ── Priority Badges ────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

const PRIORITY_VARIANT: Record<Priority, BadgeProps['variant']> = {
  LOW: 'muted',
  NORMAL: 'outline',
  HIGH: 'warning',
  URGENT: 'danger',
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  return (
    <Badge variant={PRIORITY_VARIANT[priority]} className={className}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

// ── Channel Badges ─────────────────────────────────────────────────────────

const CHANNEL_ICONS = {
  WHATSAPP: MessageCircle,
  INSTAGRAM: MessageSquare,
  MESSENGER: MessageSquare,
  WEBCHAT: MessageSquare,
  SMS: Smartphone,
  EMAIL: Mail,
};

export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  const Icon = CHANNEL_ICONS[channel] ?? MessageCircle;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className ?? ''}`}
      title={`Channel: ${channel}`}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="capitalize">{channel.toLowerCase()}</span>
    </span>
  );
}

// ── AI State Badge ─────────────────────────────────────────────────────────

export function AiStatusBadge({
  aiEnabled,
  handoffReason,
  className,
}: {
  aiEnabled: boolean;
  handoffReason?: string | null;
  className?: string;
}) {
  if (aiEnabled) {
    return (
      <Badge
        variant="outline"
        className={`gap-1 border-primary/40 bg-primary/5 text-primary text-xs ${className ?? ''}`}
      >
        <Bot className="size-3" aria-hidden />
        AI active
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={`gap-1 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs ${className ?? ''}`}
      title={handoffReason ? `Reason: ${handoffReason.replace(/_/g, ' ')}` : 'Human operator active'}
    >
      <UserCheck className="size-3" aria-hidden />
      Human takeover
    </Badge>
  );
}

// ── Message Status Icons ───────────────────────────────────────────────────

export function MessageStatusIcon({
  status,
  direction,
  className,
}: {
  status: MessageStatus;
  direction: MessageDirection;
  className?: string;
}) {
  if (direction === 'INBOUND') return null;

  switch (status) {
    case 'QUEUED':
    case 'SENDING':
      return (
        <span title="Queued">
          <Clock className={`size-3 text-muted-foreground ${className ?? ''}`} />
        </span>
      );
    case 'SENT':
      return (
        <span title="Sent">
          <Check className={`size-3 text-muted-foreground ${className ?? ''}`} />
        </span>
      );
    case 'DELIVERED':
      return (
        <span title="Delivered">
          <CheckCheck className={`size-3 text-muted-foreground ${className ?? ''}`} />
        </span>
      );
    case 'READ':
      return (
        <span title="Read">
          <CheckCheck className={`size-3 text-sky-500 ${className ?? ''}`} />
        </span>
      );
    case 'FAILED':
      return (
        <span title="Failed to deliver">
          <AlertCircle className={`size-3 text-destructive ${className ?? ''}`} />
        </span>
      );
    default:
      return null;
  }
}

// ── Date and Name Formatters ───────────────────────────────────────────────

export function formatRelativeTime(dateInput: Date | string | null): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatMessageTime(dateInput: Date | string | null): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatThreadDividerDate(dateInput: Date | string): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '';

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

export function initials(name: string | null | undefined): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? '??').toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}
