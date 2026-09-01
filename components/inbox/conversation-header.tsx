'use client';

/**
 * Top header of the active conversation thread.
 *
 * Displays customer identity, links to their profile, and exposes controls for
 * updating status, assignment, priority, and AI takeover without page reloads.
 */

import { useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AiStatusBadge,
  ChannelBadge,
  initials,
} from './conversation-badges';
import {
  assignConversationAction,
  toggleConversationAiAction,
  updateConversationPriorityAction,
  updateConversationStatusAction,
} from '@/server/actions/conversation.actions';
import type { ConversationDetail } from '@/server/services/conversation/conversation.service';
import type { ConversationStatus, Priority } from '@/server/validation/conversation';

const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-background px-2.5 text-xs shadow-soft transition-all duration-150 hover:border-primary/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

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
    <div className="flex flex-col gap-2 border-b bg-card/80 p-3 sm:px-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        {/* Contact info & Mobile back button */}
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="size-8 md:hidden shrink-0"
              aria-label="Back to conversations"
            >
              <ArrowLeft className="size-4" />
            </Button>
          ) : null}

          <Avatar className="size-9 shrink-0 border">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {displayName}
              </span>
              <Link
                href={`/contacts/${conversation.contactId}`}
                className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                title="View customer record"
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ChannelBadge channel={conversation.channel} />
              <span>•</span>
              <span className="truncate font-mono text-[11px]">{conversation.contact.phoneE164}</span>
            </div>
          </div>
        </div>

        {/* AI Toggle */}
        {conversation.can.toggleAi ? (
          <div className="flex items-center gap-2 shrink-0 bg-muted/40 px-2.5 py-1 rounded-md border">
            <AiStatusBadge
              aiEnabled={conversation.aiEnabled}
              handoffReason={conversation.handoffReason}
            />
            <Switch
              checked={conversation.aiEnabled}
              onCheckedChange={handleToggleAi}
              disabled={isPending}
              aria-label="Toggle AI automation"
            />
          </div>
        ) : (
          <AiStatusBadge
            aiEnabled={conversation.aiEnabled}
            handoffReason={conversation.handoffReason}
          />
        )}
      </div>

      {/* Control Selectors (Status, Assignee, Priority) */}
      <div className="flex items-center gap-2 pt-1 overflow-x-auto no-scrollbar flex-wrap">
        {/* Status Dropdown */}
        {conversation.can.updateStatus ? (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">Status:</span>
            <select
              value={conversation.status}
              onChange={(e) => handleStatusChange(e.target.value as ConversationStatus)}
              disabled={isPending}
              className={SELECT_CLASS}
            >
              <option value="OPEN">Open</option>
              <option value="PENDING">Pending</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
        ) : null}

        {/* Assignee Dropdown */}
        {conversation.can.assign ? (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">Assignee:</span>
            <select
              value={conversation.assignedToMemberId ?? 'unassigned'}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              disabled={isPending}
              className={SELECT_CLASS}
            >
              <option value="unassigned">Unassigned</option>
              {assignees.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Priority Dropdown */}
        {conversation.can.updateStatus ? (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">Priority:</span>
            <select
              value={conversation.priority}
              onChange={(e) => handlePriorityChange(e.target.value as Priority)}
              disabled={isPending}
              className={SELECT_CLASS}
            >
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
        ) : null}
      </div>
    </div>
  );
}
