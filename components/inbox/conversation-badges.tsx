/**
 * The inbox's shared vocabulary: how a status, a priority, a channel, who is answering,
 * and whether a message arrived are each drawn.
 *
 * Every one of these appears in at least two places — the list row, the thread header,
 * the customer panel — so they live here rather than being re-styled per screen. They are
 * all thin wrappers over the `Badge` primitive: a chip in the inbox should be
 * indistinguishable from a chip on the orders table, and the way that goes wrong is one
 * screen hand-mixing its own border and background from the raw palette.
 *
 * Date formatting deliberately does *not* live here. It is in `lib/datetime.ts` with the
 * rest of it.
 */

import { AlertCircle, Bot, Check, CheckCheck, Clock, UserRound } from 'lucide-react';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { handoffReasonLabel } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type {
  Channel,
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  Priority,
} from '@/server/validation/conversation';

/* ── Status ──────────────────────────────────────────────────────────────── */

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
  size,
  className,
}: {
  status: ConversationStatus;
  /** Passed through rather than shrunk with a `text-` override on the way in. */
  size?: BadgeProps['size'];
  className?: string;
}) {
  return (
    <Badge variant={STATUS_VARIANT[status]} size={size} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/* ── Priority ────────────────────────────────────────────────────────────── */

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
  size,
  className,
}: {
  priority: Priority;
  size?: BadgeProps['size'];
  className?: string;
}) {
  return (
    <Badge variant={PRIORITY_VARIANT[priority]} size={size} className={className}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

/* ── Channel ─────────────────────────────────────────────────────────────── */

/**
 * How each channel is named on screen.
 *
 * Spelled out rather than derived from the enum with `toLowerCase()` and a `capitalize`
 * class, which rendered "Whatsapp" — the one word in the product whose capitalisation
 * customers would notice. Only WhatsApp is connected today; the rest are here because the
 * column can already hold them, not as a claim that they work.
 */
const CHANNEL_LABELS: Record<Channel, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  MESSENGER: 'Messenger',
  WEBCHAT: 'Web chat',
  SMS: 'SMS',
  EMAIL: 'Email',
};

export function ChannelLabel({ channel, className }: { channel: Channel; className?: string }) {
  return (
    <span className={cn('text-2xs text-muted-foreground', className)}>
      {CHANNEL_LABELS[channel] ?? channel}
    </span>
  );
}

/* ── Who is answering ────────────────────────────────────────────────────── */

/**
 * Whether the AI is handling this conversation or a person has taken it over.
 *
 * Two semantic variants rather than a hand-mixed palette: `ai` is the product's one
 * reserved colour for machine-generated work, and takeover is `warning` because it means
 * *this needs a person* — not because amber looked right. The handoff reason goes through
 * `handoffReasonLabel`, so a shop owner reads "The AI wasn't sure enough" rather than
 * `LOW_CONFIDENCE`.
 */
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
      <Badge variant="ai" className={className}>
        <Bot aria-hidden />
        AI is replying
      </Badge>
    );
  }

  return (
    <Badge variant="warning" className={className}>
      <UserRound aria-hidden />
      Your team is replying
      {handoffReason ? (
        <span className="sr-only"> — {handoffReasonLabel(handoffReason)}</span>
      ) : null}
    </Badge>
  );
}

/* ── Delivery ────────────────────────────────────────────────────────────── */

type DeliveryMark = { label: string; icon: typeof Check; tone: string };

/**
 * Outbound delivery state, as WhatsApp's own ticks.
 *
 * Read is the one state that gets colour, because it is the only one worth scanning for;
 * the rest are grey so a thread does not turn into a column of blue. `text-info` rather
 * than `text-sky-500`: the palette utility does not follow the theme, and in dark mode it
 * sat at a different contrast from every other accent on screen.
 */
const DELIVERY_MARKS: Partial<Record<MessageStatus, DeliveryMark>> = {
  QUEUED: { label: 'Waiting to send', icon: Clock, tone: 'text-muted-foreground' },
  SENDING: { label: 'Sending', icon: Clock, tone: 'text-muted-foreground' },
  SENT: { label: 'Sent', icon: Check, tone: 'text-muted-foreground' },
  DELIVERED: { label: 'Delivered', icon: CheckCheck, tone: 'text-muted-foreground' },
  READ: { label: 'Read', icon: CheckCheck, tone: 'text-info' },
  FAILED: { label: 'Not delivered', icon: AlertCircle, tone: 'text-destructive' },
};

/**
 * `title` alone is not an accessible name and never reaches a touch device, so the state
 * is also written out for screen readers. The icon carries `aria-hidden` and the text
 * carries the meaning — the reverse of how this read before.
 */
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

  const mark = DELIVERY_MARKS[status];
  if (!mark) return null;

  const Icon = mark.icon;

  return (
    <span className="inline-flex items-center">
      <Icon className={cn('size-3', mark.tone, className)} aria-hidden />
      <span className="sr-only">{mark.label}</span>
    </span>
  );
}

/* ── Conversation & Lead Lifecycle V1 Badges ─────────────────────────────── */

export type ConversationLifecycleStage =
  | 'NEW'
  | 'ACTIVE'
  | 'PRODUCT_INTEREST'
  | 'READY_TO_ORDER'
  | 'AWAITING_CUSTOMER'
  | 'AWAITING_HUMAN'
  | 'CONVERTED'
  | 'CLOSED';

export type CustomerLifecycleStage =
  | 'NEW_CUSTOMER'
  | 'PROSPECT'
  | 'INTERESTED'
  | 'ORDERED'
  | 'REPEAT_CUSTOMER';

const CONVERSATION_LIFECYCLE_LABELS: Record<ConversationLifecycleStage, string> = {
  NEW: 'New Conversation',
  ACTIVE: 'Active Chat',
  PRODUCT_INTEREST: 'Product Interest',
  READY_TO_ORDER: 'Ready to Order',
  AWAITING_CUSTOMER: 'Awaiting Customer',
  AWAITING_HUMAN: 'Awaiting Human',
  CONVERTED: 'Converted',
  CLOSED: 'Closed',
};

const CONVERSATION_LIFECYCLE_VARIANTS: Record<ConversationLifecycleStage, BadgeProps['variant']> = {
  NEW: 'outline',
  ACTIVE: 'default',
  PRODUCT_INTEREST: 'info',
  READY_TO_ORDER: 'warning',
  AWAITING_CUSTOMER: 'secondary',
  AWAITING_HUMAN: 'warning',
  CONVERTED: 'success',
  CLOSED: 'muted',
};

export function ConversationLifecycleBadge({
  stage,
  size = 'sm',
  className,
}: {
  stage: ConversationLifecycleStage;
  size?: BadgeProps['size'];
  className?: string;
}) {
  return (
    <Badge
      variant={CONVERSATION_LIFECYCLE_VARIANTS[stage] ?? 'outline'}
      size={size}
      className={cn('font-medium', className)}
    >
      {CONVERSATION_LIFECYCLE_LABELS[stage] ?? stage}
    </Badge>
  );
}

const CUSTOMER_LIFECYCLE_LABELS: Record<CustomerLifecycleStage, string> = {
  NEW_CUSTOMER: 'New Customer',
  PROSPECT: 'Prospect',
  INTERESTED: 'Interested',
  ORDERED: 'Ordered',
  REPEAT_CUSTOMER: 'Repeat Customer',
};

const CUSTOMER_LIFECYCLE_VARIANTS: Record<CustomerLifecycleStage, BadgeProps['variant']> = {
  NEW_CUSTOMER: 'outline',
  PROSPECT: 'secondary',
  INTERESTED: 'info',
  ORDERED: 'default',
  REPEAT_CUSTOMER: 'success',
};

export function CustomerLifecycleBadge({
  stage,
  size = 'sm',
  className,
}: {
  stage: CustomerLifecycleStage;
  size?: BadgeProps['size'];
  className?: string;
}) {
  return (
    <Badge
      variant={CUSTOMER_LIFECYCLE_VARIANTS[stage] ?? 'outline'}
      size={size}
      className={cn('font-medium', className)}
    >
      {CUSTOMER_LIFECYCLE_LABELS[stage] ?? stage}
    </Badge>
  );
}

