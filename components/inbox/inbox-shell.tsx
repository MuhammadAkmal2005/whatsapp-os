'use client';

/**
 * Responsive Inbox shell container.
 *
 * Coordinates the two-pane split layout on desktop and single-pane drilldown on mobile.
 */

import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';

import { ConversationHeader } from './conversation-header';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';
import { ReplyComposer } from './reply-composer';
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
}: {
  page: ConversationListPage;
  activeConversation: ConversationDetail | null;
  messages: MessageView[];
  assignees: { id: string; name: string }[];
  contacts: { id: string; name: string | null; phoneE164: string }[];
}) {
  const router = useRouter();
  const selectedId = activeConversation?.id ?? null;

  const handleBackToInbox = () => {
    router.push('/conversations');
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[500px] rounded-xl border border-border bg-card shadow-card overflow-hidden">
      {/* Left pane: Conversation List */}
      <div
        className={`w-full md:w-80 lg:w-96 shrink-0 h-full ${
          selectedId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="w-full h-full">
          <ConversationList
            page={page}
            selectedId={selectedId}
            assignees={assignees}
            contacts={contacts}
          />
        </div>
      </div>

      {/* Right pane: Active Conversation or Empty Placeholder */}
      <div
        className={`flex-1 flex flex-col h-full min-w-0 bg-background ${
          selectedId ? 'flex' : 'hidden md:flex'
        }`}
      >
        {activeConversation ? (
          <>
            <ConversationHeader
              conversation={activeConversation}
              assignees={assignees}
              onBack={handleBackToInbox}
            />
            <MessageThread
              messages={messages}
              contactName={activeConversation.contact.name}
            />
            <ReplyComposer
              conversationId={activeConversation.id}
              canReply={activeConversation.can.reply}
              aiEnabled={activeConversation.aiEnabled}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/8 text-primary ring-1 ring-primary/10 mb-4">
              <MessageSquare className="size-6" aria-hidden />
            </div>
            <h3 className="text-base font-semibold text-foreground">Select a conversation</h3>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-xs">
              Choose a customer thread from the left to view messages and respond.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
