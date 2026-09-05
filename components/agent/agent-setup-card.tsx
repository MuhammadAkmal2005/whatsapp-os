'use client';

/**
 * The screen a workspace sees when it has no assistant row at all.
 *
 * Only workspaces provisioned before signup started creating an assistant land here. They are
 * real, so the screen is real: it explains what pressing the button does and then does it, rather
 * than the page quietly writing to the database while rendering.
 *
 * `provisionAgentConfig` is idempotent by lookup, and `SubmitButton` disables itself while the
 * action is in flight, so a double-press cannot produce two assistants from either end.
 */

import { Bot } from 'lucide-react';
import { useActionState } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { provisionAgentAction } from '@/server/actions/agent.actions';

export function AgentSetupCard({ canCreate }: { canCreate: boolean }) {
  const [state, formAction] = useActionState(provisionAgentAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormAlert state={state} successTitle="Assistant created" />

      <EmptyState
        icon={Bot}
        title="Set up your AI assistant"
        description="Your assistant answers customer messages on WhatsApp using your products, prices and stock. Create it now and you can give it a name, a job and your own instructions on the next screen."
        action={
          canCreate ? (
            <SubmitButton pendingText="Setting up…">Set up assistant</SubmitButton>
          ) : null
        }
        secondaryAction={
          canCreate
            ? 'It starts switched on, and will not reply to anyone until your WhatsApp number is connected.'
            : 'An owner, admin or manager on your team can set this up.'
        }
      />
    </form>
  );
}
