'use client';

/**
 * One connected WhatsApp number, and what can be done to it.
 *
 * The status words are ours, not Meta's: a shop owner needs to know whether messages are
 * arriving, so `PENDING` reads as waiting on Meta and `ERROR` reads as not working. The
 * identifiers stay verbatim and in mono, because their only job is to be compared against
 * what Meta shows in Business Manager.
 *
 * Test mode is stated on the card rather than left to a setting elsewhere. A number that looks
 * connected but is only simulating sends is the one piece of state that, if hidden here, would
 * have someone believe a customer was answered when nobody was.
 */

import { AlertTriangle, FlaskConical, Lock } from 'lucide-react';
import { useState } from 'react';

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
import type { WhatsAppAccountOverviewDTO } from '@/server/services/whatsapp/whatsapp-account.service';

import { ConnectWhatsAppForm } from './connect-whatsapp-form';
import { DisconnectWhatsAppDialog } from './disconnect-whatsapp-dialog';

type AccountStatus = WhatsAppAccountOverviewDTO['status'];
type AccountPhoneNumber = WhatsAppAccountOverviewDTO['phoneNumbers'][number];

const STATUS_LABELS: Record<AccountStatus, string> = {
  CONNECTED: 'Connected',
  PENDING: 'Waiting for Meta',
  ERROR: 'Not working',
  DISCONNECTED: 'Disconnected',
};

const STATUS_TONES: Record<AccountStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  CONNECTED: 'success',
  PENDING: 'warning',
  ERROR: 'danger',
  DISCONNECTED: 'muted',
};

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
  canConnect: boolean;
  canDisconnect: boolean;
};

export function WhatsAppAccountCard({
  account,
  canConnect,
  canDisconnect,
}: WhatsAppAccountCardProps) {
  const [editing, setEditing] = useState(false);

  const primaryPhone =
    account.phoneNumbers.find((phone) => phone.isDefault) ?? account.phoneNumbers[0];
  const name = account.displayName?.trim();
  const updateFormId = `update-whatsapp-${account.id}`;

  return (
    <Card>
      <CardToolbar>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <CardTitle>{name || primaryPhone?.displayPhoneNumber || 'WhatsApp number'}</CardTitle>
            <Badge variant={STATUS_TONES[account.status]}>{STATUS_LABELS[account.status]}</Badge>
            {account.isMock ? (
              <Badge variant="warning">
                <FlaskConical aria-hidden />
                Test mode
              </Badge>
            ) : null}
          </div>
          {name && primaryPhone ? (
            <CardDescription>
              Customers message you on {primaryPhone.displayPhoneNumber}.
            </CardDescription>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canConnect && account.status !== 'DISCONNECTED' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing((current) => !current)}
              aria-expanded={editing}
              aria-controls={updateFormId}
            >
              {editing ? 'Cancel' : 'Update details'}
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

        {account.status === 'ERROR' && account.lastErrorMessage ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>WhatsApp refused the last request</AlertTitle>
            <AlertDescription>
              {account.lastErrorMessage}
              {account.lastErrorAt ? ` Reported ${formatRelativeTime(account.lastErrorAt)}.` : ''}{' '}
              Your access token may have expired — update the details above to fix it.
            </AlertDescription>
          </Alert>
        ) : null}

        {editing ? (
          <div id={updateFormId} className="rounded-md border border-border bg-surface-sunken p-4">
            <h3 className="mb-4 text-sm font-semibold text-foreground">Update these details</h3>
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
          Your access token is stored encrypted and is never shown again.
        </span>
        {account.connectedAt ? <span>Connected {formatDate(account.connectedAt)}</span> : null}
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
          <Badge variant={STATUS_TONES[phone.status]} size="sm">
            {STATUS_LABELS[phone.status]}
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
