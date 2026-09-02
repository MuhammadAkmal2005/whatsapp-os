'use client';

/**
 * The three fields a shop owner changes most often, and the reason they are not
 * part of the edit form below them.
 *
 * Marking a customer VIP, moving a lead a stage forward, or handing them to a
 * colleague are single decisions made mid-conversation, usually on a phone. Putting
 * them behind "Edit → change → Save" costs three taps and a page state; here each
 * one saves on selection.
 *
 * Nothing is optimistic beyond the selected value itself. The picker shows what you
 * chose while the request is in flight, then defers to whatever the server says —
 * including on failure, where it reverts. A control that keeps displaying a value
 * the server rejected is worse than one that flickers, because the reader walks away
 * believing the change stuck.
 */

import { useActionState, useEffect, useRef, useState } from 'react';

import { FormAlert } from '@/components/ui/form-alert';
import { NativeSelect } from '@/components/ui/native-select';
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state';
import {
  assignContactAction,
  setContactStatusAction,
  setLeadStageAction,
} from '@/server/actions/contact.actions';
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
} from '@/server/validation/contact';

type Option = { value: string; label: string };

type ServerAction = (prev: FormState, formData: FormData) => Promise<FormState>;

export function ContactQuickControls({
  contactId,
  status,
  leadStage,
  assignedToMemberId,
  assignees,
  canUpdate,
}: {
  contactId: string;
  status: string;
  leadStage: string;
  assignedToMemberId: string | null;
  assignees: { id: string; name: string }[];
  canUpdate: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <SaveOnChange
        label="Status"
        name="status"
        contactId={contactId}
        value={status}
        options={CONTACT_STATUSES.map((value) => ({
          value,
          label: CONTACT_STATUS_LABELS[value],
        }))}
        action={setContactStatusAction}
        disabled={!canUpdate}
      />

      <SaveOnChange
        label="Lead stage"
        name="leadStage"
        contactId={contactId}
        value={leadStage}
        options={LEAD_STAGES.map((value) => ({ value, label: LEAD_STAGE_LABELS[value] }))}
        action={setLeadStageAction}
        disabled={!canUpdate}
      />

      <SaveOnChange
        label="Looked after by"
        name="assignedToMemberId"
        contactId={contactId}
        value={assignedToMemberId ?? ''}
        options={[
          { value: '', label: 'Nobody yet' },
          ...assignees.map((assignee) => ({ value: assignee.id, label: assignee.name })),
        ]}
        action={assignContactAction}
        disabled={!canUpdate}
        // A suspended member keeps the customers they already hold, but is absent from
        // `assignees` — that list is people who may be *newly* assigned. Without this
        // the field would render as "Nobody yet", which reads as data loss.
        unknownValueLabel="Currently assigned (no longer active)"
      />
    </div>
  );
}

function SaveOnChange({
  label,
  name,
  contactId,
  value,
  options,
  action,
  disabled,
  unknownValueLabel,
}: {
  label: string;
  name: string;
  contactId: string;
  value: string;
  options: Option[];
  action: ServerAction;
  disabled: boolean;
  /** How to render a current value that is not among the choices. Omit it when the
   *  value always comes from a closed enum, where the case cannot arise. */
  unknownValueLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM_STATE);
  const [chosen, setChosen] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Any answer from the server ends the optimistic display, whichever way it went.
  // On success `value` has already changed underneath us; on failure it has not, and
  // dropping the local pick is what makes the control snap back to the truth.
  useEffect(() => {
    setChosen(null);
  }, [value, state]);

  const withCurrent =
    unknownValueLabel && !options.some((option) => option.value === value)
      ? [...options, { value, label: unknownValueLabel }]
      : options;

  return (
    <form action={formAction} ref={formRef} className="flex flex-col gap-1.5">
      <input type="hidden" name="contactId" value={contactId} />

      <label className="text-xs font-medium text-muted-foreground" htmlFor={`${name}-${contactId}`}>
        {label}
      </label>

      <NativeSelect
        id={`${name}-${contactId}`}
        name={name}
        value={chosen ?? value}
        disabled={disabled || pending}
        onChange={(event) => {
          setChosen(event.target.value);
          // requestSubmit rather than submit: it runs validation and fires the submit
          // event, which is what React's action handling listens for.
          formRef.current?.requestSubmit();
        }}
      >
        {withCurrent.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>

      {state.status === 'error' ? <FormAlert state={state} /> : null}
    </form>
  );
}
