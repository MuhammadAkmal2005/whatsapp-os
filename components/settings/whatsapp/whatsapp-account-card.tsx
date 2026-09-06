'use client';

/**
 * One connected WhatsApp number, and what can be done to it.
 *
 * The status words are ours, not Meta's, and they live in `connection-status.ts` so this
 * card and the health panel below it cannot disagree about what `DEGRADED` means. The
 * identifiers stay verbatim and in mono, because their only job is to be compared against
 * what Meta shows in Business Manager.
 *
 * Everything rendered here is safe to render. The DTO carries Meta's own identifiers, our
 * lifecycle timestamps and sentences we wrote; the encrypted token and registration PIN are
 * not on it, so there is no prop on this component that could carry a secret to the browser.
 *
 * Test mode is stated on the card rather than left to a setting elsewhere. A number that looks
 * connected but is only simulating sends is the one piece of state that, if hidden here, would
 * have someone believe a customer was answered when nobody was.
 */

import { AlertTriangle, FlaskConical, Lock } from 'lucide-react';
import { useState } from 'react';

import { ConnectionHealthPanel } from '@/components/settings/whatsapp/connection-health-panel';
import {
  CONNECTION_STATUS_LABELS,
  CONNECTION_STATUS_SUMMARIES,
  CONNECTION_STATUS_TONES,
} from '@/components/settings/whatsapp/connection-status';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardTitle,
  CardToolbar,
} from '@/components/ui/card';
import { formatDate, formatRelativeTime } from '@/lib/datetime';
import { humaniseCode } from '@/lib/labels';
import type { ConnectionHealthReport } from '@/server/services/whatsapp/meta-connection-health.service';
import type { WhatsAppAccountOverviewDTO } from '@/server/services/whatsapp/whatsapp-account.service';

import { ConnectWhatsAppForm } from './connect-whatsapp-form';
import { DisconnectWhatsAppDialog } from './disconnect-whatsapp-dialog';
import { EmbeddedSignupButton } from './embedded-signup-button';
import type { EmbeddedSignupConfig } from './connect-whatsapp-card';

type AccountPhoneNumber = WhatsAppAccountOverviewDTO['phoneNumbers'][number];

/**
 * Meta's own quality-rating scale, in words instead of a colour name. Anything Meta adds later
 * falls through to the raw value rather than being guessed at.
 */
const QUALITY_LABELS: Record<string, string> = {
  GREEN: 'Good',
  YELLOW: 'Needs attention',
  RED: 'At risk',
  UNKNOWN: 'Not rated yet',
};

type WhatsAppAccountCardProps = {
  account: WhatsAppAccountOverviewDTO;
  /** Null when the report could not be built; the panel is then simply absent. */
  health: ConnectionHealthReport | null;
  embeddedSignup: EmbeddedSignupConfig | null;
  canConnect: boolean;
  canDisconnect: boolean;
};

export function WhatsAppAccountCard({
  account,
  health,
  embeddedSignup,
  canConnect,
  canDisconnect,
}: WhatsAppAccountCardProps) {
  const [editing, setEditing] = useState(false);

  const primaryPhone =
    account.phoneNumbers.find((phone) => phone.isDefault) ?? account.phoneNumbers[0];
  const name = account.displayName?.trim();
  const updateFormId = `update-whatsapp-${account.id}`;
  const needsAttention = account.status === 'DEGRADED' || account.status === 'ERROR';

  return (
    <Card>
      <CardToolbar>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <CardTitle>{name || primaryPhone?.displayPhoneNumber || 'WhatsApp number'}</CardTitle>
            <Badge variant={CONNECTION_STATUS_TONES[account.status]} dot>
              {CONNECTION_STATUS_LABELS[account.status]}
            </Badge>
            {account.isMock ? (
              <Badge variant="warning">
                <FlaskConical aria-hidden />
                Test mode
              </Badge>
            ) : null}
          </div>
          <CardDescription>
            {name && primaryPhone
              ? `Customers message you on ${primaryPhone.displayPhoneNumber}. `
              : ''}
            {CONNECTION_STATUS_SUMMARIES[account.status]}
          </CardDescription>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Offered on a disconnected card too. Disconnecting deletes the token, so coming
              back means supplying a fresh one — and this is the same number, with the same
              history, which is exactly why an owner who disconnected by accident wants it. */}
          {canConnect ? (
            <Button
              variant={account.status === 'DISCONNECTED' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setEditing((current) => !current)}
              aria-expanded={editing}
              aria-controls={updateFormId}
            >
              {editing ? 'Cancel' : 'Reconnect'}
            </Button>
          ) : null}

          {canDisconnect && account.status !== 'DISCONNECTED' ? (
            <DisconnectWhatsAppDialog
              accountId={account.id}
              wabaId={account.wabaId}
              displayPhoneNumber={primaryPhone?.displayPhoneNumber}
            />
          ) : null}
        </div>
      </CardToolbar>

      <CardContent className="flex flex-col gap-5 border-t border-border pt-5">
        {account.isMock ? (
          <Alert variant="warning">
            <FlaskConical aria-hidden />
            <AlertTitle>This workspace is in test mode</AlertTitle>
            <AlertDescription>
              Messages are simulated so you can try the product safely. Nothing sent from here
              reaches a customer, and nothing a customer sends reaches this inbox.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* One alert for both broken states, told apart by the heading. `lastErrorMessage` is a
            sentence we wrote — the classifier and the health check both store owner-safe copy —
            so it is rendered verbatim without risk of leaking Meta's internals. */}
        {needsAttention && account.lastErrorMessage ? (
          <Alert variant={account.status === 'ERROR' ? 'destructive' : 'warning'}>
            <AlertTriangle aria-hidden />
            <AlertTitle>
              {account.status === 'ERROR'
                ? 'WhatsApp refused the last request'
                : 'This connection needs attention'}
            </AlertTitle>
            <AlertDescription>
              {account.lastErrorMessage}
              {account.lastErrorAt ? ` Reported ${formatRelativeTime(account.lastErrorAt)}.` : ''}
            </AlertDescription>
          </Alert>
        ) : null}

        {editing ? (
          <div
            id={updateFormId}
            className="flex flex-col gap-5 rounded-md border border-border bg-surface-sunken p-4"
          >
            <h3 className="text-sm font-semibold text-foreground">Reconnect this number</h3>

            {embeddedSignup ? (
              <EmbeddedSignupButton
                appId={embeddedSignup.appId}
                configId={embeddedSignup.configId}
                graphVersion={embeddedSignup.graphVersion}
                isUpdate
              />
            ) : null}

            <ConnectWhatsAppForm
              initialValues={{
                wabaId: account.wabaId,
                phoneNumberId: primaryPhone?.phoneNumberId,
                displayPhoneNumber: primaryPhone?.displayPhoneNumber,
                displayName: account.displayName,
              }}
              isUpdate
            />
          </div>
        ) : null}

        {health ? (
          <ConnectionHealthPanel
            accountId={account.id}
            report={health}
            canCheck={canConnect}
          />
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="eyebrow">Numbers on this account</h3>
          {account.phoneNumbers.length > 0 ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {account.phoneNumbers.map((phone) => (
                <PhoneNumberRow key={phone.id} phone={phone} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No number is registered on this account yet.
            </p>
          )}
        </section>

        <p className="text-sm text-muted-foreground">
          WhatsApp Business account ID <span className="font-mono">{account.wabaId}</span> — the
          same ID Meta shows for this account.
        </p>
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3.5" aria-hidden />
          {account.status === 'DISCONNECTED'
            ? 'The saved access token was deleted when this number was disconnected.'
            : 'Your access token is stored encrypted and is never shown again.'}
        </span>
        <span className="inline-flex flex-wrap gap-x-4">
          {/* Two different facts, and the second is the one Meta cannot tell us: a number that
              sent something recently works, whatever a status column claims. */}
          {account.connectedAt ? <span>Connected {formatDate(account.connectedAt)}</span> : null}
          {account.disconnectedAt ? (
            <span>Disconnected {formatDate(account.disconnectedAt)}</span>
          ) : null}
          {account.lastOutboundSuccessAt ? (
            <span>Last reply sent {formatRelativeTime(account.lastOutboundSuccessAt)}</span>
          ) : null}
        </span>
      </CardFooter>
    </Card>
  );
}

function PhoneNumberRow({ phone }: { phone: AccountPhoneNumber }) {
  const quality = phone.qualityRating
    ? QUALITY_LABELS[phone.qualityRating] ?? humaniseCode(phone.qualityRating)
    : null;

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="font-medium text-foreground">{phone.displayPhoneNumber}</span>
          <Badge variant={CONNECTION_STATUS_TONES[phone.status]} size="sm">
            {CONNECTION_STATUS_LABELS[phone.status]}
          </Badge>
          {phone.isDefault ? (
            <Badge variant="muted" size="sm">
              Used for replies
            </Badge>
          ) : null}
        </div>

        {phone.verifiedName ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Shows to customers as {phone.verifiedName}.
          </p>
        ) : null}

        <p className="mt-1 text-xs text-muted-foreground">
          Phone number ID <span className="font-mono">{phone.phoneNumberId}</span>
          {/* A number that is not on Cloud API cannot send, however valid the token is —
              so the platform type is worth stating rather than leaving to the health panel. */}
          {phone.platformType && phone.platformType !== 'CLOUD_API'
            ? ` — not on Cloud API yet, so replies cannot be sent from it`
            : ''}
        </p>
      </div>

      {quality ? (
        <p className="text-sm text-muted-foreground">
          Message quality <span className="text-foreground">{quality}</span>
        </p>
      ) : null}
    </li>
  );
}
