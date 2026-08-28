'use client';

import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit2,
  Phone,
  Radio,
  Server,
  ShieldCheck,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/datetime';
import type { WhatsAppAccountOverviewDTO } from '@/server/services/whatsapp/whatsapp-account.service';
import { ConnectWhatsAppForm } from './connect-whatsapp-form';
import { DisconnectWhatsAppDialog } from './disconnect-whatsapp-dialog';

type WhatsAppAccountCardProps = {
  account: WhatsAppAccountOverviewDTO;
  canConnect: boolean;
  canDisconnect: boolean;
};

export function WhatsAppAccountCard({
  account,
  canConnect,
  canDisconnect,
}: WhatsAppAccountCardProps) {
  const [editing, setEditing] = useState(false);
  const primaryPhone = account.phoneNumbers.find((p) => p.isDefault) ?? account.phoneNumbers[0];

  const statusBadgeVariant = {
    CONNECTED: 'default' as const,
    ERROR: 'danger' as const,
    DISCONNECTED: 'secondary' as const,
    PENDING: 'warning' as const,
  }[account.status] ?? 'secondary';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border bg-muted/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Phone className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">
                  {account.displayName || primaryPhone?.displayPhoneNumber || 'WhatsApp Account'}
                </CardTitle>
                <Badge variant={statusBadgeVariant} className="uppercase text-2xs">
                  {account.status}
                </Badge>
                {account.isMock ? (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Radio className="mr-1 size-3 animate-pulse" />
                    Simulated Mode
                  </Badge>
                ) : null}
              </div>
              <CardDescription className="mt-1 font-mono text-xs">
                WABA ID: {account.wabaId}
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canConnect && account.status !== 'DISCONNECTED' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(!editing)}
              >
                <Edit2 className="mr-1.5 size-3.5" />
                {editing ? 'Cancel' : 'Update Credentials'}
              </Button>
            ) : null}

            {canDisconnect && account.status === 'CONNECTED' ? (
              <DisconnectWhatsAppDialog
                accountId={account.id}
                wabaId={account.wabaId}
                displayPhoneNumber={primaryPhone?.displayPhoneNumber}
              />
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6 pt-6">
        {account.isMock ? (
          <Alert className="border-amber-500/20 bg-amber-500/5 text-amber-900 dark:text-amber-200">
            <Server className="size-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle>Simulated WhatsApp Connection</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              This workspace is currently running in simulated WhatsApp mode. Outbound sends and inbound
              customer messages are simulated locally for development and offline testing.
            </AlertDescription>
          </Alert>
        ) : null}

        {account.status === 'ERROR' && account.lastErrorMessage ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Connection Issue Detected</AlertTitle>
            <AlertDescription className="text-xs">
              {account.lastErrorMessage}
              {account.lastErrorAt ? ` (Logged ${formatDate(account.lastErrorAt)})` : ''}
            </AlertDescription>
          </Alert>
        ) : null}

        {editing ? (
          <div className="rounded-lg border border-border bg-muted/20 p-5">
            <h4 className="mb-4 text-sm font-semibold">Update Credentials & Token</h4>
            <ConnectWhatsAppForm
              initialValues={{
                wabaId: account.wabaId,
                phoneNumberId: primaryPhone?.phoneNumberId,
                displayPhoneNumber: primaryPhone?.displayPhoneNumber,
                displayName: account.displayName,
              }}
              isUpdate={true}
            />
          </div>
        ) : null}

        <div>
          <h4 className="mb-3 text-sm font-medium text-muted-foreground">Connected Phone Numbers</h4>
          <div className="divide-y divide-border rounded-md border border-border">
            {account.phoneNumbers.map((phone) => (
              <div
                key={phone.id}
                className="flex flex-wrap items-center justify-between gap-4 p-4 text-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Phone className="size-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{phone.displayPhoneNumber}</span>
                      {phone.isDefault ? (
                        <Badge variant="secondary" className="text-2xs">Default</Badge>
                      ) : null}
                      {phone.qualityRating ? (
                        <Badge variant="outline" className="text-2xs">
                          Quality: {phone.qualityRating}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Phone Number ID: <span className="font-mono">{phone.phoneNumberId}</span>
                      {phone.verifiedName ? ` · Verified Name: ${phone.verifiedName}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="size-4 text-emerald-600" />
                  <span>Routing Active</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-600" />
            <span>Token encrypted with AES-256-GCM</span>
          </div>
          {account.connectedAt ? (
            <div>Connected on {formatDate(account.connectedAt)}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
