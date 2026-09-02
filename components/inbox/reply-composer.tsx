'use client';

/**
 * The reply box.
 *
 * Deliberately plain: a field, a send button, and a line of state. The previous version
 * had its own rounded geometry, its own focus ring on top of the global one, and its own
 * error box — three private copies of things the design system already owns, in the one
 * control a shop owner uses hundreds of times a day.
 *
 * It grows with the message up to a ceiling rather than scrolling from the first line, and
 * it does that by measuring the textarea, which is the one place in this file where
 * touching the DOM directly is the simplest correct answer.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Bot, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FormAlert } from '@/components/ui/form-alert';
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state';
import { cn } from '@/lib/utils';
import { sendMessageAction } from '@/server/actions/conversation.actions';

/** One line to about six, then it scrolls. Past that the box eats the thread it belongs to. */
const MIN_COMPOSER_HEIGHT = 38;
const MAX_COMPOSER_HEIGHT = 152;

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
  const [state, setState] = useState<FormState>(IDLE_FORM_STATE);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(Math.max(element.scrollHeight, MIN_COMPOSER_HEIGHT), MAX_COMPOSER_HEIGHT)}px`;
  }, []);

  // Also runs after a successful send, when `body` is cleared programmatically rather than
  // by typing, so the box collapses back to one line instead of staying tall and empty.
  useEffect(resize, [body, resize]);

  const send = () => {
    const text = body.trim();
    if (!text || isPending) return;

    setState(IDLE_FORM_STATE);

    const formData = new FormData();
    formData.set('conversationId', conversationId);
    formData.set('direction', 'OUTBOUND');
    formData.set('type', 'TEXT');
    formData.set('body', text);

    startTransition(async () => {
      const result = await sendMessageAction(IDLE_FORM_STATE, formData);
      if (result.status === 'error') {
        setState(result);
        return;
      }
      setBody('');
    });
  };

  if (!canReply) {
    return (
      <div className="border-t border-border bg-surface-sunken px-4 py-3 text-center text-xs text-muted-foreground">
        Your role can read this conversation but not reply to it. Ask an admin if you need to.
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-card px-3 py-3 sm:px-4">
      {aiEnabled ? (
        <p className="mb-2 flex items-start gap-1.5 text-2xs text-ai">
          <Bot className="mt-px size-3 shrink-0" aria-hidden />
          <span>
            Your AI is answering this customer. Anything you send here goes out under your
            business name alongside its replies.
          </span>
        </p>
      ) : null}

      <FormAlert state={state} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className={cn('flex items-end gap-2', state.status === 'error' && 'mt-2')}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="reply-body" className="sr-only">
            Your reply
          </label>
          <Textarea
            id="reply-body"
            ref={textareaRef}
            rows={1}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, because this is a chat and that is what a chat does. The hint
              // lives below the field rather than inside the placeholder, which had grown
              // into a sentence the reader had to parse before they could start typing.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Write a reply…"
            disabled={isPending}
            aria-describedby="reply-hint"
            className="min-h-0 resize-none overflow-y-auto py-2 leading-normal scrollbar-thin"
            style={{ height: MIN_COMPOSER_HEIGHT }}
          />
        </div>

        <Button
          type="submit"
          size="icon"
          disabled={body.trim().length === 0}
          isLoading={isPending}
          aria-label="Send reply"
        >
          <Send aria-hidden />
        </Button>
      </form>

      <p id="reply-hint" className="mt-1.5 text-3xs text-muted-foreground">
        Enter to send, Shift + Enter for a new line
      </p>
    </div>
  );
}
