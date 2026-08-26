import { Mail, UserPlus, Users } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { InviteMemberForm } from '@/components/settings/team/invite-member-form';
import { LeaveWorkspaceButton } from '@/components/settings/team/leave-workspace-button';
import { MemberActions } from '@/components/settings/team/member-actions';
import { RevokeInviteButton } from '@/components/settings/team/revoke-invite-button';
import { formatDate, formatRelativeTime } from '@/lib/datetime';
import { can } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';
import { redirect } from 'next/navigation';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/server/authz/permissions';
import { getTeam, type PendingInvite, type TeamMember } from '@/server/services/member/member.service';

export const metadata = { title: 'Team' };

/**
 * The team roster.
 *
 * Every control on this page renders from a boolean the service computed, so the
 * page contains no authorization reasoning of its own — and every one of those
 * controls posts to a server action that checks the same rule again. The booleans
 * decide what is *shown*; the service decides what is *allowed*.
 */
export default async function TeamSettingsPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const team = await getTeam(context);
  const mayInvite = can(context, 'member:invite');
  const now = new Date();
  const liveInvites = team.invites.filter((invite) => invite.expiresAt > now);

  return (
    <div className="flex flex-col gap-6">
      {mayInvite ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite someone to help</CardTitle>
            <CardDescription>
              Add the people who answer your customers. Each person signs in with their own
              account, so you always know who replied to whom.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {team.canInvite.allowed ? (
              <InviteMemberForm assignableRoles={team.assignableRoles} />
            ) : (
              <Alert variant="warning">
                <Users className="size-4" aria-hidden />
                <AlertTitle>No seats left on your plan</AlertTitle>
                <AlertDescription>{team.canInvite.reason}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your team</CardTitle>
          <CardDescription>
            {team.seats.limit === null
              ? `${team.members.length} ${team.members.length === 1 ? 'person' : 'people'} — your plan has no seat limit.`
              : `${team.seats.used} of ${team.seats.limit} seats used. Pending invitations count towards this.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border border-t border-border">
            {team.members.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </ul>
        </CardContent>
      </Card>

      {mayInvite ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>
              People who have been invited but have not signed in yet. Invitations expire after
              seven days.
            </CardDescription>
          </CardHeader>
          <CardContent className={liveInvites.length > 0 ? 'p-0' : undefined}>
            {liveInvites.length > 0 ? (
              <ul className="divide-y divide-border border-t border-border">
                {liveInvites.map((invite) => (
                  <InviteRow key={invite.id} invite={invite} />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={UserPlus}
                title="No invitations waiting"
                description="When you invite someone, their invitation appears here until they join."
                className="border-0 py-10"
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      <LeaveWorkspaceButton
        workspaceName={context.workspaceName}
        blockedReason={team.canLeave.allowed ? null : team.canLeave.reason}
      />
    </div>
  );
}

function MemberRow({ member }: { member: TeamMember }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4">
      <Avatar>
        {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
        <AvatarFallback>{initials(member.name)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-foreground">{member.name}</span>
          {member.isYou ? <Badge variant="secondary">You</Badge> : null}
          {member.role === 'OWNER' ? <Badge variant="default">Owner</Badge> : null}
          {member.status === 'SUSPENDED' ? <Badge variant="warning">Paused</Badge> : null}
        </div>
        <p className="truncate text-sm text-muted-foreground">{member.email}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {ROLE_DESCRIPTIONS[member.role]}{' '}
          <span className="whitespace-nowrap">
            Joined {formatDate(member.joinedAt)}
            {member.lastActiveAt
              ? ` · active ${formatRelativeTime(member.lastActiveAt)}`
              : ' · not signed in yet'}
          </span>
        </p>
      </div>

      <div className="ms-auto">
        <MemberActions
          memberId={member.id}
          name={member.name}
          email={member.email}
          role={member.role}
          status={member.status}
          assignableRoles={member.assignableRoles}
          can={member.can}
        />
      </div>
    </li>
  );
}

function InviteRow({ invite }: { invite: PendingInvite }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Mail className="size-4" aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-foreground">{invite.email}</span>
          <Badge variant="outline">{ROLE_LABELS[invite.role]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Invited by {invite.invitedByName} · expires {formatRelativeTime(invite.expiresAt)}
        </p>
      </div>

      <div className="ms-auto">
        <RevokeInviteButton inviteId={invite.id} email={invite.email} />
      </div>
    </li>
  );
}

/** Two letters from a name, for the avatar fallback. Handles single-word names,
 *  which are common in Pakistan, without producing an empty circle. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0);
  if (!first) return '?';
  const last = parts.length > 1 ? parts.at(-1) : undefined;
  const value = last ? `${first.slice(0, 1)}${last.slice(0, 1)}` : first.slice(0, 2);
  return value.toUpperCase();
}
