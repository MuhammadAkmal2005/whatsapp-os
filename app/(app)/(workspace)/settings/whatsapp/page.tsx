import { MessageSquare } from 'lucide-react';
import { redirect } from 'next/navigation';

import { ConnectWhatsAppCard } from '@/components/settings/whatsapp/connect-whatsapp-card';
import { WhatsAppAccountCard } from '@/components/settings/whatsapp/whatsapp-account-card';
import { EmptyState } from '@/components/ui/empty-state';
import { env, isEmbeddedSignupConfigured } from '@/config/env';
import { getConnectionHealthReports } from '@/server/services/whatsapp/meta-connection-health.service';
import { getWhatsAppAccountOverview } from '@/server/services/whatsapp/whatsapp-account.service';
import { can } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata = { title: 'WhatsApp' };

/**
 * Connecting and managing the business's WhatsApp number.
 *
 * Written for the shop owner rather than for whoever set up the Meta account: the words on the
 * screen are about messages arriving and customers being answered, and the technical names
 * appear only where the owner has to match them against something Meta actually shows them.
 *
 * All five connection states are reachable from here, and none of them is inferred from a
 * token existing. `getConnectionHealthReports` reads the cached verdict of the last real check
 * — one database read, no Graph traffic on page load — and the panel's "Check now" button is
 * what spends a round trip on Meta.
 *
 * A disconnected account still gets a card. It holds the history the business paid for, and
 * hiding it left an owner who had disconnected by accident with no way back to the same number;
 * the connect card appears alongside it rather than instead of it.
 *
 * The three Embedded Signup values are read here, on the server, and passed down deliberately.
 * All three are public — the app id appears in Meta's own popup URL — but they travel as props
 * rather than through `NEXT_PUBLIC_` variables so that adding a fourth value to this flow means
 * touching a server component, not widening what the whole client bundle can see.
 */
export default async function WhatsAppSettingsPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const [accounts, healthReports] = await Promise.all([
    getWhatsAppAccountOverview(context),
    getConnectionHealthReports(context),
  ]);

  const canConnect = can(context, 'whatsapp:connect');
  const canDisconnect = can(context, 'whatsapp:disconnect');

  const healthByAccount = new Map(healthReports.map((report) => [report.accountId, report]));

  const embeddedSignup =
    isEmbeddedSignupConfigured && env.META_APP_ID && env.META_LOGIN_CONFIG_ID
      ? {
          appId: env.META_APP_ID,
          configId: env.META_LOGIN_CONFIG_ID,
          graphVersion: env.WHATSAPP_API_VERSION,
        }
      : null;

  const liveAccounts = accounts.filter((account) => account.status !== 'DISCONNECTED');
  const disconnectedAccounts = accounts.filter((account) => account.status === 'DISCONNECTED');

  if (accounts.length === 0 && !canConnect) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="WhatsApp is not connected yet"
        description="Nothing reaches your inbox until your business number is connected. An owner or admin can do that from this page."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {liveAccounts.map((account) => (
        <WhatsAppAccountCard
          key={account.id}
          account={account}
          health={healthByAccount.get(account.id) ?? null}
          embeddedSignup={canConnect ? embeddedSignup : null}
          canConnect={canConnect}
          canDisconnect={canDisconnect}
        />
      ))}

      {liveAccounts.length === 0 && canConnect ? (
        <ConnectWhatsAppCard
          embeddedSignup={embeddedSignup}
          hasPreviousConnection={disconnectedAccounts.length > 0}
        />
      ) : null}

      {disconnectedAccounts.map((account) => (
        <WhatsAppAccountCard
          key={account.id}
          account={account}
          health={healthByAccount.get(account.id) ?? null}
          embeddedSignup={canConnect ? embeddedSignup : null}
          canConnect={canConnect}
          canDisconnect={canDisconnect}
        />
      ))}
    </div>
  );
}
