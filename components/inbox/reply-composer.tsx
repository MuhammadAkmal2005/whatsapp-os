'use client';

/**
 * Bottom reply composer for the active conversation.
 *
 * Provides a responsive textarea with keyboard shortcuts (Enter to send, Shift+Enter
 * for newline), pending submission states, and inline error feedback.
 */

import { useRef, useState, useTransition } from 'react';
import { Send, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { sendMessageAction } from '@/server/actions/conversation.actions';

export function ReplyComposer({
  conversationId,
  canReply,
  aiEnabled,
}: {
  conversationId: string;
  canReply: boolean;
  aiEnabled: boolean;
}) {
  const [body, setBody] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = body.trim();
    if (!text || isPending || !canReply) return;

    setErrorMessage(null);

    const formData = new FormData();
    formData.set('conversationId', conversationId);
    formData.set('direction', 'OUTBOUND');
    formData.set('type', 'TEXT');
    formData.set('body', text);

    startTransition(async () => {
      const result = await sendMessageAction({ status: 'idle' }, formData);
      if (result.status === 'error') {
        setErrorMessage(result.message ?? 'Failed to send message.');
      } else {
        setBody('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
    // Auto-expand height up to 140px
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 140)}px`;
  };

  if (!canReply) {
    return (
      <div className="border-t bg-muted/40 p-3 text-center text-xs text-muted-foreground">
        You do not have permission to reply to this conversation.
      </div>
    );
  }

  return (
    <div className="border-t bg-card p-3 sm:px-4">
      {aiEnabled ? (
        <div className="flex items-center gap-1.5 mb-2 text-[11px] text-primary/80 bg-primary/5 px-2.5 py-1 rounded-md border border-primary/20">
          <Sparkles className="size-3 shrink-0 text-primary" aria-hidden />
          <span>
            AI is currently active on this conversation and may reply automatically to new customer messages.
          </span>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mb-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 p-2 rounded-md">
          {errorMessage}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="relative flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            rows={1}
            value={body}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            disabled={isPending}
            className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm shadow-soft transition-all duration-150 placeholder:text-muted-foreground hover:border-primary/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary/40 disabled:opacity-50 min-h-[40px] max-h-[140px]"
          />
        </div>

        <Button
          type="submit"
          size="icon"
          disabled={!body.trim() || isPending}
          className="size-10 rounded-xl shrink-0 gap-1"
          aria-label="Send message"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
