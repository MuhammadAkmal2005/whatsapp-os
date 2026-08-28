'use client';

/**
 * Message bubble renderer for individual inbound and outbound messages.
 *
 * Handles rich message presentations, attachments (images, documents, audio),
 * sender attributions, error indicators, and monotonic delivery checkmarks.
 */

import { Bot, FileText, Image as ImageIcon, Music, Video } from 'lucide-react';

import { formatMessageTime, MessageStatusIcon } from './conversation-badges';
import type { MessageView } from '@/server/services/conversation/message.service';

export function MessageBubble({ message }: { message: MessageView }) {
  const isOutbound = message.direction === 'OUTBOUND';
  const isFailed = message.status === 'FAILED';

  const senderName = isOutbound
    ? message.sentByAi
      ? 'AI Assistant'
      : message.senderMember?.user.name ?? 'Team Member'
    : message.senderContact?.name ?? 'Customer';

  return (
    <div className={`flex flex-col gap-1 w-full ${isOutbound ? 'items-end' : 'items-start'}`}>
      {/* Sender label */}
      <div className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground font-medium">
        {message.sentByAi ? <Bot className="size-3 text-primary" aria-hidden /> : null}
        <span>{senderName}</span>
      </div>

      {/* Bubble Container */}
      <div
        className={`relative max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-xs transition-colors ${
          isOutbound
            ? 'bg-primary text-primary-foreground rounded-br-xs'
            : 'bg-muted/80 text-foreground border rounded-bl-xs'
        } ${isFailed ? 'border-destructive bg-destructive/10 text-destructive' : ''}`}
      >
        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 ? (
          <div className="flex flex-col gap-2 mb-1.5">
            {message.attachments.map((att) => (
              <div key={att.id} className="rounded-md overflow-hidden bg-black/10 p-2">
                {att.kind === 'IMAGE' ? (
                  <div className="flex items-center gap-2">
                    <ImageIcon className="size-5 shrink-0" aria-hidden />
                    <span className="truncate text-xs">{att.fileName ?? 'Image attachment'}</span>
                  </div>
                ) : att.kind === 'DOCUMENT' ? (
                  <div className="flex items-center gap-2">
                    <FileText className="size-5 shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{att.fileName ?? 'Document'}</p>
                      {att.byteSize ? (
                        <p className="text-[10px] opacity-80">
                          {Math.round(att.byteSize / 1024)} KB
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : att.kind === 'AUDIO' ? (
                  <div className="flex items-center gap-2">
                    <Music className="size-5 shrink-0" aria-hidden />
                    <span className="text-xs">Voice message</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Video className="size-5 shrink-0" aria-hidden />
                    <span className="text-xs">{att.fileName ?? 'Video'}</span>
                  </div>
                )}
                {att.caption ? <p className="text-xs mt-1 italic">{att.caption}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* Text body */}
        {message.body ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
        ) : null}

        {/* Failure message if failed */}
        {isFailed && message.errorMessage ? (
          <p className="text-[11px] text-destructive font-medium mt-1">
            Failed: {message.errorMessage}
          </p>
        ) : null}

        {/* Timestamp & Status Icon */}
        <div
          className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
            isOutbound ? 'text-primary-foreground/75' : 'text-muted-foreground'
          }`}
        >
          <span>{formatMessageTime(message.occurredAt ?? message.createdAt)}</span>
          <MessageStatusIcon
            status={message.status}
            direction={message.direction}
            className={isOutbound ? 'text-primary-foreground/90' : undefined}
          />
        </div>
      </div>
    </div>
  );
}
