import { redirect } from 'next/navigation';

import { AgentConfigForm } from '@/components/agent/agent-config-form';
import { AgentSetupCard } from '@/components/agent/agent-setup-card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatBand } from '@/components/ui/stat';
import { roleHasPermission } from '@/server/authz/permissions';
import { getAgentConfig } from '@/server/services/agent/agent-config.service';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata = { title: 'AI assistant' };

/**
 * The AI assistant configuration screen.
 *
 * Two honest states rather than one convenient one. `getAgentConfig` returns null for a workspace
 * created before signup started provisioning an assistant, and that renders a setup card with a
 * button — the page does not write to the database while rendering itself, which would make a
 * reload a mutation.
 *
 * `agent:read` is on every role from VIEWER upwards, so this page needs no read gate; `agent:update`
 * starts at MANAGER, and that is the one the form is handed. Neither check is the protection —
 * `requirePermission` inside the service is — but a screen full of controls that fail on save is a
 * worse screen than one that says who can use them.
 *
 * The counters are read-only and live above the form, where they read as "what your assistant has
 * done" rather than as settings with a stuck value.
 */
export default async function AgentPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const agent = await getAgentConfig(context);
  const canUpdate = roleHasPermission(context.role, 'agent:update');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI assistant"
        description="Your assistant answers customer messages on WhatsApp using your products, prices and stock. Tell it who it is and what your business does, and it takes the routine questions off your phone."
        badges={
          agent ? (
            <Badge variant={agent.isActive ? 'success' : 'muted'} dot>
              {agent.isActive ? 'Answering customers' : 'Switched off'}
            </Badge>
          ) : null
        }
      />

      {agent ? (
        <>
          <StatBand columns={3} label="What your assistant has handled">
            <Stat
              label="Chats answered"
              value={agent.conversationsHandled.toLocaleString()}
              hint="all time"
            />
            <Stat
              label="Handed to your team"
              value={agent.handoffCount.toLocaleString()}
              hint="all time"
            />
            <Stat label="Orders placed" value={agent.ordersCreated.toLocaleString()} hint="all time" />
          </StatBand>

          <AgentConfigForm agent={agent} canUpdate={canUpdate} />
        </>
      ) : (
        <AgentSetupCard canCreate={canUpdate} />
      )}
    </div>
  );
}
