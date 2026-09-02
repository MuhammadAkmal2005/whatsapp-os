'use client';

/**
 * The inbox's two-pane frame.
 *
 * On a wide screen the list and the thread sit side by side. Below `md` only one is on
 * screen at a time, and selecting a conversation drills into it — a genuinely different
 * layout rather than a narrowed version of the desktop one.
 *
 * Height is the interesting part. This is the one screen in the product that must fill the
 * viewport exactly, because both panes scroll internally and a page-level scrollbar would
 * mean the composer drifts off the bottom while you type. The previous version guessed at
 * `100vh - 8.5rem`, which was wrong at every width and had a `min-h` floor that reintroduced
 * page scrolling on a short screen. It now subtracts `--shell-inset`, which the app shell
 * sets from its own header height and padding, so the two cannot disagree.
 *
 * Below `sm` the pane cancels the shell's horizontal padding. Thirty-two pixels is nine per
 * cent of a 360px screen, and a message thread is the last place in the product that can
 * spare it.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';

import { ConversationHeader } from './conversation-header';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';
import { ReplyComposer } from './reply-composer';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import type {
  ConversationDetail,
  ConversationListPage,
} from '@/server/services/conversation/conversation.service';
import type { MessageView } from '@/server/services/conversation/message.service';

export function InboxShell({
  page,
  activeConversation,
  messages,
  assignees,
  contacts,
  now,
}: {
  page: ConversationListPage;
  activeConversation: ConversationDetail | null;
  messages: MessageView[];
  assignees: { id: string; name: string }[];
  contacts: { id: string; name: string | null; phoneE164: string }[];
  /** Resolved once on the server so every relative time on the screen shares one instant. */
  now: Date;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedId = activeConversation?.id ?? null;

  // Going back to the list keeps the search and filters that were used to find this
  // conversation. Pushing a bare `/conversations` threw them away, which on a phone meant
  // reading one message cost you the search you had typed to get to it.
  const backToList = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('id');
    const query = params.toString();
    router.push(query ? `/conversations?${query}` : '/conversations');
  };

  return (
    <section
      aria-labelledby="inbox-heading"
      className={cn(
        'flex overflow-hidden border-y border-border bg-card',
        '-mx-4 sm:mx-0 sm:rounded-lg sm:border',
        'h-[calc(100dvh-var(--shell-inset,6rem))]',
      )}
    >
      {/* The visible titles live inside the panes, and on a phone the list pane is removed
          from the layout while a thread is open — so the page's own heading is here, where
          it survives both states. */}
      <h1 id="inbox-heading" className="sr-only">
        Inbox
      </h1>

      <div
        className={cn(
          'h-full w-full shrink-0 md:w-80 lg:w-96',
          selectedId ? 'hidden md:block' : 'block',
        )}
      >
        <ConversationList
          page={page}
          selectedId={selectedId}
          assignees={assignees}
          contacts={contacts}
          now={now}
        />
      </div>

      <div
        className={cn(
          'h-full min-w-0 flex-1 flex-col bg-background',
          selectedId ? 'flex' : 'hidden md:flex',
        )}
      >
        {activeConversation ? (
          <>
            <ConversationHeader
              conversation={activeConversation}
              assignees={assignees}
              onBack={backToList}
            />
            <MessageThread
              messages={messages}
              contactName={activeConversation.contact.name}
              now={now}
            />
            <ReplyComposer
              conversationId={activeConversation.id}
              canReply={activeConversation.can.reply}
              aiEnabled={activeConversation.aiEnabled}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessagesSquare}
              title="Choose a conversation"
              description="Pick a customer on the left to read the thread and reply."
              variant="plain"
              size="compact"
            />
          </div>
        )}
      </div>
    </section>
  );
}
