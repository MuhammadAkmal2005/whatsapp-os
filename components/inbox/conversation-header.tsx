'use client';

/**
 * Top header of the active conversation thread.
 *
 * Displays customer identity, links to their profile, and exposes controls for
 * updating status, assignment, priority, and AI takeover without page reloads.
 *
 * The three controls sit on a second line that scrolls horizontally on a narrow screen
 * rather than wrapping into a three-row block. A phone screen is the case where the
 * message list matters most, so the header stays two lines tall at every width.
 */

import { useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { AiStatusBadge, ChannelLabel } from './conversation-badges';
import { initials } from '@/lib/names';
import {
  assignConversationAction,
  toggleConversationAiAction,
  updateConversationPriorityAction,
  updateConversationStatusAction,
} from '@/server/actions/conversation.actions';
import type { ConversationDetail } from '@/server/services/conversation/conversation.service';
import type { ConversationStatus, Priority } from '@/server/validation/conversation';

export function ConversationHeader({
  conversation,
  assignees,
  onBack,
}: {
  conversation: ConversationDetail;
  assignees: { id: string; name: string }[];
  onBack?: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (newStatus: ConversationStatus) => {
    const formData = new FormData();
    formData.set('conversationId', conversation.id);
    formData.set('status', newStatus);
    startTransition(async () => {
      await updateConversationStatusAction({ status: 'idle' }, formData);
    });
  };

  const handleAssigneeChange = (newMemberId: string) => {
    const formData = new FormData();
    formData.set('conversationId', conversation.id);
    if (newMemberId && newMemberId !== 'unassigned') {
      formData.set('assignedToMemberId', newMemberId);
    }
    startTransition(async () => {
      await assignConversationAction({ status: 'idle' }, formData);
    });
  };

  const handlePriorityChange = (newPriority: Priority) => {
    const formData = new FormData();
    formData.set('conversationId', conversation.id);
    formData.set('priority', newPriority);
    startTransition(async () => {
      await updateConversationPriorityAction({ status: 'idle' }, formData);
    });
  };

  const handleToggleAi = (checked: boolean) => {
    const formData = new FormData();
    formData.set('conversationId', conversation.id);
    formData.set('aiEnabled', checked ? 'true' : 'false');
    if (!checked) {
      formData.set('handoffReason', 'MANUAL_TAKEOVER');
    }
    startTransition(async () => {
      await toggleConversationAiAction({ status: 'idle' }, formData);
    });
  };

  const displayName =
    conversation.contact.name ||
    conversation.contact.waProfileName ||
    conversation.contact.phoneE164;

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-card px-3 py-2.5 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {onBack ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
              className="shrink-0 md:hidden"
              aria-label="Back to conversations"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </Button>
          ) : null}

          <Avatar className="shrink-0">
            <AvatarFallback>{initials(displayName)}</AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {/* A heading, not a styled span: this names the thread pane, and it is the
                  second landmark under the inbox's own hidden heading. */}
              <h2 className="truncate text-sm font-semibold text-foreground">{displayName}</h2>
              <Link
                href={`/contacts/${conversation.contactId}`}
                className="shrink-0 rounded-xs text-muted-foreground transition-colors duration-instant ease-out hover:text-primary"
                aria-label={`Open the customer record for ${displayName}`}
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </div>
            <div className="flex items-center gap-2 text-2xs text-muted-foreground">
              {/* Named in full here, unlike in the list row: this is the thread's identity
                  line and has the room for it. */}
              <ChannelLabel channel={conversation.channel} />
              <span aria-hidden>·</span>
              <span className="truncate tabular-nums">{conversation.contact.phoneE164}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Only shown while a control is in flight, so a change on a slow connection
              does not look like it was ignored. */}
          {isPending ? (
            <span className="hidden items-center gap-1.5 text-2xs text-muted-foreground sm:flex">
              <Spinner className="size-3.5" label="Saving" />
              Saving
            </span>
          ) : null}

          {conversation.can.toggleAi ? (
            <div className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-surface-sunken px-2.5 py-1">
              <AiStatusBadge
                aiEnabled={conversation.aiEnabled}
                handoffReason={conversation.handoffReason}
              />
              <Switch
                checked={conversation.aiEnabled}
                onCheckedChange={handleToggleAi}
                disabled={isPending}
                aria-label="Let the AI reply to this conversation"
              />
            </div>
          ) : (
            <AiStatusBadge
              aiEnabled={conversation.aiEnabled}
              handoffReason={conversation.handoffReason}
            />
          )}
        </div>
      </div>

      <div
        // Scrolls sideways rather than wrapping: a wrapped control strip pushes the
        // message list down by two more rows exactly on the screen where it is scarcest.
        // The py-0.5 keeps the focus outline from being clipped by the scroll container.
        className="flex items-center gap-3 overflow-x-auto py-0.5 scrollbar-none"
        aria-busy={isPending}
      >
        {conversation.can.updateStatus ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <label className="eyebrow" htmlFor="conversation-status">
              Status
            </label>
            <NativeSelect
              id="conversation-status"
              value={conversation.status}
              onChange={(e) => handleStatusChange(e.target.value as ConversationStatus)}
              disabled={isPending}
              wrapperClassName="w-auto"
              className="sm:h-control-sm sm:text-xs"
            >
              <option value="OPEN">Open</option>
              <option value="PENDING">Pending</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </NativeSelect>
          </div>
        ) : null}

        {conversation.can.assign ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <label className="eyebrow" htmlFor="conversation-assignee">
              Handled by
            </label>
            <NativeSelect
              id="conversation-assignee"
              value={conversation.assignedToMemberId ?? 'unassigned'}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              disabled={isPending}
              wrapperClassName="w-auto"
              className="sm:h-control-sm sm:text-xs"
            >
              <option value="unassigned">Nobody yet</option>
              {assignees.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        {conversation.can.updateStatus ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <label className="eyebrow" htmlFor="conversation-priority">
              Priority
            </label>
            <NativeSelect
              id="conversation-priority"
              value={conversation.priority}
              onChange={(e) => handlePriorityChange(e.target.value as Priority)}
              disabled={isPending}
              wrapperClassName="w-auto"
              className="sm:h-control-sm sm:text-xs"
            >
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </NativeSelect>
          </div>
        ) : null}
      </div>
    </div>
  );
}
