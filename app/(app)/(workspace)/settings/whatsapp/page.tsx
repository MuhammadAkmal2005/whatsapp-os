import { redirect } from 'next/navigation';
import { MessageSquare } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ConnectWhatsAppForm } from '@/components/settings/whatsapp/connect-whatsapp-form';
import { WhatsAppAccountCard } from '@/components/settings/whatsapp/whatsapp-account-card';
import { can } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';
import { getWhatsAppAccountOverview } from '@/server/services/whatsapp/whatsapp-account.service';

export const metadata = { title: 'WhatsApp Settings' };

/**
 * WhatsApp Channel Management Settings Page.
 *
 * Provides workspace owners and admins with a dashboard to connect, manage,
 * verify, and disconnect Meta WhatsApp Business Cloud API accounts.
 */
export default async function WhatsAppSettingsPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const accounts = await getWhatsAppAccountOverview(context);
  const canConnect = can(context, 'whatsapp:connect');
  const canDisconnect = can(context, 'whatsapp:disconnect');

  // Filter for active/connected/error accounts
  const activeAccounts = accounts.filter((a) => a.status !== 'DISCONNECTED');
  const hasActiveAccount = activeAccounts.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">WhatsApp Integration</h2>
        <p className="text-sm text-muted-foreground">
          Manage your official Meta WhatsApp Business Platform connection, phone numbers, and credentials.
        </p>
      </div>

      {hasActiveAccount ? (
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
      ) : (
        <div className="flex flex-col gap-6">
          {canConnect ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <MessageSquare className="size-4" />
                  </div>
                  <CardTitle>Connect WhatsApp Business Account</CardTitle>
                </div>
                <CardDescription>
                  Enter your Meta WhatsApp Cloud API credentials to enable customer messaging,
                  AI automation, and order processing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ConnectWhatsAppForm />
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="No WhatsApp account connected"
              description="Your business does not have an active WhatsApp connection. Contact a workspace owner or admin to connect your WhatsApp Business number."
            />
          )}
        </div>
      )}
    </div>
  );
}
