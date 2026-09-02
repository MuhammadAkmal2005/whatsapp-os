'use client';

/**
 * One message in a thread.
 *
 * The bubble is the surface a shop owner looks at more than any other in the product, so
 * it is drawn from the design system rather than styled by hand: system radii, the two
 * semantic surfaces (`primary` for what we sent, `card` for what the customer sent), and
 * no shadow at all. The previous version leaned on `shadow-soft`, which compiles to
 * nothing in this Tailwind version — the bubbles have never had the elevation the code
 * claimed, and adding it now would only make a dense thread noisier.
 *
 * Attribution sits above the bubble rather than inside it, and only when it changes, so a
 * run of replies from the same sender reads as one voice.
 */

import { Bot, FileText, ImageIcon, Music, Video, type LucideIcon } from 'lucide-react';

import { MessageStatusIcon } from './conversation-badges';
import { formatTimeOfDay } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import type { MessageView } from '@/server/services/conversation/message.service';

type Attachment = MessageView['attachments'][number];

/**
 * What each attachment kind is called and drawn as.
 *
 * Sentence case, and named for what the customer sent rather than for the enum: a voice
 * note is what a WhatsApp customer thinks they sent, `AUDIO` is what the column stores.
 */
const ATTACHMENT_KINDS: Record<string, { icon: LucideIcon; fallbackName: string }> = {
  IMAGE: { icon: ImageIcon, fallbackName: 'Photo' },
  DOCUMENT: { icon: FileText, fallbackName: 'Document' },
  AUDIO: { icon: Music, fallbackName: 'Voice note' },
  VIDEO: { icon: Video, fallbackName: 'Video' },
  STICKER: { icon: ImageIcon, fallbackName: 'Sticker' },
};

export function MessageBubble({
  message,
  showSender,
}: {
  message: MessageView;
  /** False when the previous message came from the same sender on the same day. */
  showSender: boolean;
}) {
  const isOutbound = message.direction === 'OUTBOUND';
  const isFailed = message.status === 'FAILED';
  const attachments = message.attachments ?? [];

  const senderName = isOutbound
    ? message.sentByAi
      ? 'Your AI'
      : (message.senderMember?.user.name ?? 'Your team')
    : (message.senderContact?.name ?? 'Customer');

  return (
    <div className={cn('flex w-full flex-col gap-1', isOutbound ? 'items-end' : 'items-start')}>
      {showSender ? (
        <div className="flex items-center gap-1 px-0.5 text-2xs font-medium text-muted-foreground">
          {message.sentByAi ? <Bot className="size-3 text-ai" aria-hidden /> : null}
          <span>{senderName}</span>
        </div>
      ) : null}

      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm sm:max-w-[68ch]',
          // A single squared corner on the sender's side is the whole tail. It orients the
          // bubble without the pointer triangle, which never survives a background change.
          isOutbound
            ? 'rounded-br-xs bg-primary text-primary-foreground'
            : 'rounded-bl-xs border border-border bg-card text-foreground',
          // Failure repaints the whole bubble rather than adding a stripe to it: an
          // undelivered message should not look like a delivered one wearing a badge.
          isFailed && 'border border-destructive-border bg-destructive-surface text-foreground',
        )}
      >
        {attachments.length > 0 ? (
          <ul className="mb-1.5 flex flex-col gap-1.5">
            {attachments.map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                attachment={attachment}
                onPrimarySurface={isOutbound && !isFailed}
              />
            ))}
          </ul>
        ) : null}

        {message.body ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
        ) : null}

        {isFailed ? (
          /* The provider's own error text is a developer-facing string — "(#131047)
             Re-engagement message" — so it is not printed. What a shop owner can act on is
             that it did not arrive and can be sent again. */
          <p className="mt-1 text-2xs font-medium text-destructive">
            Not delivered. Send it again.
          </p>
        ) : null}

        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-3xs tabular-nums',
            isOutbound && !isFailed ? 'text-primary-foreground/80' : 'text-muted-foreground',
          )}
        >
          <time dateTime={new Date(message.occurredAt ?? message.createdAt).toISOString()}>
            {formatTimeOfDay(new Date(message.occurredAt ?? message.createdAt), 'en-PK')}
          </time>
          <MessageStatusIcon
            status={message.status}
            direction={message.direction}
            className={isOutbound && !isFailed ? 'text-primary-foreground/90' : undefined}
          />
        </div>
      </div>

      {/* Consecutive bubbles from one sender drop the visible label, which would otherwise
          repeat down the thread. A screen reader still needs it on every message, or the
          run reads as an unattributed wall of text. */}
      {showSender ? null : <span className="sr-only">{senderName}</span>}
    </div>
  );
}

/**
 * An attachment, as a description rather than a link.
 *
 * There is no media route and no signed-URL helper in this codebase, so nothing here can
 * open the file — and a row that looks clickable but is not is worse than one that plainly
 * is not. What it can honestly show is what arrived and how big it is. When media serving
 * is built, this row becomes the link.
 */
function AttachmentRow({
  attachment,
  onPrimarySurface,
}: {
  attachment: Attachment;
  onPrimarySurface: boolean;
}) {
  const kind = ATTACHMENT_KINDS[attachment.kind] ?? ATTACHMENT_KINDS['DOCUMENT'];
  const Icon = kind?.icon ?? FileText;

  return (
    <li
      className={cn(
        'flex items-start gap-2 rounded-md px-2 py-1.5',
        onPrimarySurface ? 'bg-primary-hover' : 'bg-surface-sunken',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">
          {attachment.fileName ?? kind?.fallbackName ?? 'Attachment'}
        </p>
        {attachment.byteSize ? (
          <p className={cn('text-3xs', onPrimarySurface ? 'opacity-75' : 'text-muted-foreground')}>
            {formatFileSize(attachment.byteSize)}
          </p>
        ) : null}
        {attachment.caption ? <p className="mt-1 text-xs">{attachment.caption}</p> : null}
      </div>
    </li>
  );
}

/** kB below a megabyte, MB above. Rounded, because nobody reads an attachment size to the byte. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
