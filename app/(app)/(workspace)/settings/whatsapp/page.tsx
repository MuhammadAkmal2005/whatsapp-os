import { MessageSquare } from 'lucide-react';
import { redirect } from 'next/navigation';

import { ConnectWhatsAppForm } from '@/components/settings/whatsapp/connect-whatsapp-form';
import { WhatsAppAccountCard } from '@/components/settings/whatsapp/whatsapp-account-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
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
 * A disconnected account is kept in the record but is not listed as a connection, because it no
 * longer carries messages — the connect card says so rather than leaving the row to imply it.
 */
export default async function WhatsAppSettingsPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const accounts = await getWhatsAppAccountOverview(context);
  const canConnect = can(context, 'whatsapp:connect');
  const canDisconnect = can(context, 'whatsapp:disconnect');

  // A disconnected account still exists and still holds its history; it simply no longer
  // receives anything, so it does not belong in a list of live connections.
  const activeAccounts = accounts.filter((account) => account.status !== 'DISCONNECTED');
  const hasPreviousConnection = accounts.length > activeAccounts.length;

  if (activeAccounts.length > 0) {
    return (
      <div className="flex flex-col gap-6">
        {activeAccounts.map((account) => (
          <WhatsAppAccountCard
            key={account.id}
            account={account}
            canConnect={canConnect}
            canDisconnect={canDisconnect}
          />
        ))}
      </div>
    );
  }

  if (!canConnect) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="WhatsApp is not connected yet"
        description="Nothing reaches your inbox until your business number is connected. An owner or admin can do that from this page."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect your WhatsApp Business number</CardTitle>
        <CardDescription>
          Your customers keep messaging the same number. Once it is connected their messages
          arrive in your inbox, your AI can answer them, and you can raise an order straight from
          a chat. You will need the details Meta shows for your WhatsApp Business account.
          {hasPreviousConnection
            ? ' A number you disconnected earlier is kept in your records, but it no longer receives messages.'
            : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConnectWhatsAppForm />
      </CardContent>
    </Card>
  );
}
