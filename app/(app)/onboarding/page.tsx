import type { Metadata } from 'next';

import { PreWorkspaceShell } from '@/components/app-shell/pre-workspace-shell';
import { CreateWorkspaceForm } from '@/components/onboarding/create-workspace-form';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Create your business',
};

/**
 * First stop after signing up. A brand-new account has no workspace, so this is
 * where one is created; the action provisions it and redirects into the
 * dashboard. Someone who already has workspaces can still reach here to add
 * another.
 *
 * Heading left-aligned rather than centred so this reads as a continuation of the
 * sign-up screen it follows, not as a separate modal moment.
 */
export default function OnboardingPage() {
  return (
    <PreWorkspaceShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Create your business</h1>
          <p className="text-sm text-muted-foreground">
            One workspace per business. Next you&apos;ll connect WhatsApp and teach your AI about
            what you sell — you can invite your team whenever you like.
          </p>
        </div>

        <Card>
          <CardContent className="pt-5">
            <CreateWorkspaceForm />
          </CardContent>
        </Card>
      </div>
    </PreWorkspaceShell>
  );
}
