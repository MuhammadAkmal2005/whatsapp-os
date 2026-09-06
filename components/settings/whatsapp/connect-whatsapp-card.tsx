'use client';

/**
 * The "not connected" state: how a business gets its number onto ConvoNexa.
 *
 * Two official paths, deliberately not presented as equals. Embedded Signup is Meta's own
 * dialog and it is the one a shop owner can finish alone, so it leads. The System User token
 * path is the same Meta platform reached the long way round, and it is here because a
 * deployment awaiting Tech Provider approval has no Embedded Signup configuration id — and
 * because a business whose Meta account was set up by someone else already has a token.
 *
 * When Embedded Signup is available the token form is folded away rather than removed. Two
 * forms of equal weight would make an owner choose between things they cannot tell apart.
 */

import { useState } from 'react';

import { ConnectWhatsAppForm } from '@/components/settings/whatsapp/connect-whatsapp-form';
import { EmbeddedSignupButton } from '@/components/settings/whatsapp/embedded-signup-button';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export type EmbeddedSignupConfig = {
  appId: string;
  configId: string;
  graphVersion: string;
};

type ConnectWhatsAppCardProps = {
  /** Null when this deployment cannot offer Meta's dialog; the token path is then the only one. */
  embeddedSignup: EmbeddedSignupConfig | null;
  /** True when a number was connected here before and later disconnected. */
  hasPreviousConnection: boolean;
};

export function ConnectWhatsAppCard({
  embeddedSignup,
  hasPreviousConnection,
}: ConnectWhatsAppCardProps) {
  const [showTokenForm, setShowTokenForm] = useState(!embeddedSignup);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect your WhatsApp Business number</CardTitle>
        <CardDescription>
          Your customers keep messaging the same number. Once it is connected their messages
          arrive in your inbox, your AI can answer them, and you can raise an order straight from
          a chat.
          {hasPreviousConnection
            ? ' A number you disconnected earlier is kept in your records, but it no longer receives messages.'
            : ''}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {embeddedSignup ? (
          <EmbeddedSignupButton
            appId={embeddedSignup.appId}
            configId={embeddedSignup.configId}
            graphVersion={embeddedSignup.graphVersion}
          />
        ) : null}

        {embeddedSignup ? (
          <>
            <Separator />
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">
                Already have a system user access token from Meta Business Manager?
              </p>
              <div>
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => setShowTokenForm((current) => !current)}
                  aria-expanded={showTokenForm}
                  aria-controls="connect-with-token"
                >
                  {showTokenForm ? 'Hide the token option' : 'Connect with a token instead'}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            You will need the details Meta shows for your WhatsApp Business account, and a system
            user access token from Business Manager.
          </p>
        )}

        {showTokenForm ? (
          <div id="connect-with-token">
            <ConnectWhatsAppForm />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
