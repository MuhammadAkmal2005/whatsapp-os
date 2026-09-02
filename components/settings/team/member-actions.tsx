'use client';

import { Crown, MoreHorizontal, PauseCircle, PlayCircle, UserMinus } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FormAlert } from '@/components/ui/form-alert';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state';
import {
  changeMemberRoleAction,
  removeMemberAction,
  setMemberStatusAction,
  transferOwnershipAction,
} from '@/server/actions/member.actions';
import { ROLE_LABELS, type WorkspaceRole } from '@/server/authz/permissions';

/**
 * Per-member controls: a role select, and a menu of the three heavier actions.
 *
 * Every capability is decided on the server and arrives as a boolean, so this
 * component holds no copy of the authorization rules — it renders conclusions. Each
 * action still goes through a server action that re-checks the permission, the
 * workspace scope and the state rules, so forcing a control open in the DOM buys
 * nothing.
 *
 * The menu items only open dialogs; no form lives inside the dropdown. Radix
 * unmounts its content when the menu closes, and a form submitted from inside it
 * would be torn down mid-flight — a bug that appears only intermittently, which is
 * the worst kind.
 */
export type MemberActionCapabilities = {
  changeRole: boolean;
  suspend: boolean;
  remove: boolean;
  transferOwnership: boolean;
};

export type MemberActionsProps = {
  memberId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: 'ACTIVE' | 'SUSPENDED';
  /** Roles this actor may assign to this member. Empty disables the select. */
  assignableRoles: WorkspaceRole[];
  can: MemberActionCapabilities;
};

type OpenDialog = 'none' | 'remove' | 'transfer' | 'status';

export function MemberActions(props: MemberActionsProps) {
  const [dialog, setDialog] = useState<OpenDialog>('none');
  const close = () => setDialog('none');

  const hasMenu = props.can.suspend || props.can.remove || props.can.transferOwnership;
  const canEditRole = props.can.changeRole && props.assignableRoles.length > 0;

  // The row already states the role as a badge, so this column holds controls only. With no
  // control to offer — a VIEWER or AGENT looking at the team — it contributes nothing.
  if (!canEditRole && !hasMenu) return null;

  return (
    <div className="flex items-center justify-end gap-1">
      {canEditRole ? (
        <RoleSelect
          memberId={props.memberId}
          name={props.name}
          current={props.role}
          options={props.assignableRoles}
        />
      ) : null}

      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`More actions for ${props.name}`}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {props.can.suspend ? (
              <DropdownMenuItem onSelect={() => setDialog('status')}>
                {props.status === 'ACTIVE' ? (
                  <PauseCircle aria-hidden />
                ) : (
                  <PlayCircle aria-hidden />
                )}
                {props.status === 'ACTIVE' ? 'Pause access' : 'Restore access'}
              </DropdownMenuItem>
            ) : null}

            {props.can.transferOwnership ? (
              <DropdownMenuItem onSelect={() => setDialog('transfer')}>
                <Crown aria-hidden />
                Transfer ownership
              </DropdownMenuItem>
            ) : null}

            {props.can.remove ? (
              <DropdownMenuItem destructive onSelect={() => setDialog('remove')}>
                <UserMinus aria-hidden />
                Remove from team
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <StatusDialog {...props} open={dialog === 'status'} onClose={close} />
      <TransferOwnershipDialog {...props} open={dialog === 'transfer'} onClose={close} />
      <RemoveMemberDialog {...props} open={dialog === 'remove'} onClose={close} />
    </div>
  );
}

/**
 * Role as a native select that submits on change.
 *
 * One field, so a separate save button would be ceremony. Native because it is
 * keyboard- and screen-reader-correct for free, and on a phone it opens the
 * platform picker.
 *
 * The current role stays selected until the server confirms; on failure the select
 * is reset to what the server still believes, so the UI never shows a role the
 * member does not actually hold.
 */
function RoleSelect({
  memberId,
  name,
  current,
  options,
}: {
  memberId: string;
  name: string;
  current: WorkspaceRole;
  options: WorkspaceRole[];
}) {
  const [state, formAction] = useActionState(changeMemberRoleAction, IDLE_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (state.status === 'error' && selectRef.current) selectRef.current.value = current;
  }, [state, current]);

  // The member's own role may not be one the actor can assign — an ADMIN can see a
  // MANAGER without being able to grant MANAGER. Including it keeps the select
  // showing the truth; re-selecting it is refused as a no-op.
  const choices = options.includes(current) ? options : [current, ...options];

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="memberId" value={memberId} />
      <label className="sr-only" htmlFor={`role-${memberId}`}>
        Role for {name}
      </label>
      <RoleSelectControl
        id={`role-${memberId}`}
        ref={selectRef}
        current={current}
        choices={choices}
        onChange={() => formRef.current?.requestSubmit()}
      />
      {state.status === 'error' && state.message ? (
        <span role="status" className="text-xs text-destructive">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** Split out so `useFormStatus` can read the enclosing form — it only reports for
 *  a form above the component that calls it. */
function RoleSelectControl({
  id,
  ref,
  current,
  choices,
  onChange,
}: {
  id: string;
  ref: React.Ref<HTMLSelectElement>;
  current: WorkspaceRole;
  choices: WorkspaceRole[];
  onChange: () => void;
}) {
  const { pending } = useFormStatus();

  return (
    <NativeSelect
      id={id}
      ref={ref}
      name="role"
      defaultValue={current}
      disabled={pending}
      aria-busy={pending}
      onChange={onChange}
      // A role change saves immediately, so the cursor says "working" rather than "blocked".
      className="disabled:cursor-progress"
      wrapperClassName="w-auto"
    >
      {choices.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Closes a dialog once its action succeeds, so the row's new state is what the
 *  person sees next rather than a stale panel to dismiss. */
function useCloseOnSuccess(state: FormState, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (open && state.status === 'success') onClose();
  }, [open, state.status, onClose]);
}

type DialogProps = MemberActionsProps & { open: boolean; onClose: () => void };

function StatusDialog({ memberId, name, status, open, onClose }: DialogProps) {
  const [state, formAction] = useActionState(setMemberStatusAction, IDLE_FORM_STATE);
  useCloseOnSuccess(state, open, onClose);
  const pausing = status === 'ACTIVE';

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {pausing ? `Pause ${name}'s access?` : `Restore ${name}'s access?`}
          </DialogTitle>
          <DialogDescription>
            {pausing
              ? 'They stay on your team but cannot sign in to this business until you restore access. Useful for staff who are away.'
              : 'They will be able to sign in to this business again, with the same role as before.'}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <FormAlert state={state} />
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="status" value={pausing ? 'SUSPENDED' : 'ACTIVE'} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton
              variant={pausing ? 'secondary' : 'default'}
              pendingText={pausing ? 'Pausing…' : 'Restoring…'}
            >
              {pausing ? 'Pause access' : 'Restore access'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberDialog({ memberId, name, email, open, onClose }: DialogProps) {
  const [state, formAction] = useActionState(removeMemberAction, IDLE_FORM_STATE);
  useCloseOnSuccess(state, open, onClose);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {name} from your team?</DialogTitle>
          <DialogDescription>
            {email} loses access immediately. Conversations and orders they handled stay in your
            records. You can invite them again later.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <FormAlert state={state} />
          <input type="hidden" name="memberId" value={memberId} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Keep them
            </Button>
            <SubmitButton variant="destructive" pendingText="Removing…">
              Remove from team
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferOwnershipDialog({ memberId, name, email, open, onClose }: DialogProps) {
  const [state, formAction] = useActionState(transferOwnershipAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;
  useCloseOnSuccess(state, open, onClose);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make {name} the owner?</DialogTitle>
          <DialogDescription>
            {name} takes over billing and full control of this business. You stay on as an admin, so
            you keep day-to-day access — but only they can hand ownership back.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <FormAlert state={state} />
          <input type="hidden" name="memberId" value={memberId} />
          {/* The server re-reads the member row for the real address; this copy only
              drives the typed confirmation. */}
          <input type="hidden" name="expectedEmail" value={email} />

          <FormField error={fieldErrors?.confirmEmail?.[0]}>
            <FormLabel>Type their email to confirm</FormLabel>
            <FormControl>
              <Input name="confirmEmail" autoComplete="off" placeholder={email} required />
            </FormControl>
            <FormDescription>You cannot undo this yourself.</FormDescription>
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pendingText="Transferring…">Transfer ownership</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
