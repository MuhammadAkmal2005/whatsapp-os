import { redirect } from 'next/navigation';

import { InboxShell } from '@/components/inbox/inbox-shell';
import { firstParam } from '@/lib/search-params';
import { getContacts } from '@/server/services/contact/contact.service';
import {
  getConversation,
  listConversations,
  type ConversationDetail,
} from '@/server/services/conversation/conversation.service';
import { listMessages, type MessageView } from '@/server/services/conversation/message.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listConversationsSchema } from '@/server/validation/conversation';

export const metadata = { title: 'Inbox — Conversations' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const params = await searchParams;
  const selectedId = firstParam(params.id);

  const parsed = listConversationsSchema.safeParse({
    search: firstParam(params.search),
    status: firstParam(params.status),
    priority: firstParam(params.priority),
    assignedToMemberId: firstParam(params.assignedTo),
    cursor: firstParam(params.cursor),
  });

  const input = parsed.success ? parsed.data : listConversationsSchema.parse({});

  // Load conversation list and contacts/assignees in parallel
  const [page, contactResult] = await Promise.all([
    listConversations(context, input),
    getContacts(context, { limit: 50, search: null, assignedTo: null }).catch(() => ({
      contacts: [],
      assignees: [],
    })),
  ]);

  const assignees = contactResult.assignees ?? [];

  const contacts = contactResult.contacts.map((c) => ({
    id: c.id,
    name: c.name,
    phoneE164: c.phoneE164,
  }));

  // If a conversation ID was requested in search params, load its details and messages
  let activeConversation: ConversationDetail | null = null;
  let messages: MessageView[] = [];

  const targetId = selectedId || (page.conversations.length > 0 ? page.conversations[0]?.id : null);

  if (targetId) {
    try {
      const [detail, messagePage] = await Promise.all([
        getConversation(context, targetId),
        listMessages(context, { conversationId: targetId, limit: 50 }),
      ]);
      activeConversation = detail;
      messages = messagePage.rows;
    } catch {
      // Stale or cross-tenant ID in query string degrades safely to null
      activeConversation = null;
    }
  }

  // One instant for the whole screen, resolved here rather than in each row, so that "3h"
  // on one conversation and "4h" on the next are measured from the same moment and the
  // server's markup matches the client's first render.
  const now = new Date();

  // No page header. This screen is the full height of the viewport by design, and the
  // heading it would carry — "Inbox" — is already in the sidebar as the active nav item and
  // inside the pane as its own title. A band above it would only push the composer down.
  return (
    <InboxShell
      page={page}
      activeConversation={activeConversation}
      messages={messages}
      assignees={assignees}
      contacts={contacts}
      now={now}
    />
  );
}
