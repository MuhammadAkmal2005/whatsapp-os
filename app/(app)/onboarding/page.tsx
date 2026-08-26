import type { Metadata } from 'next';

import { PreWorkspaceShell } from '@/components/app-shell/pre-workspace-shell';
import { CreateWorkspaceForm } from '@/components/onboarding/create-workspace-form';

export const metadata: Metadata = {
  title: 'Create your business',
};

/**
 * First stop after signing up. A brand-new account has no workspace, so this is
 * where one is created; the action provisions it and redirects into the
 * dashboard. Someone who already has workspaces can still reach here to add
 * another.
 */
export default function OnboardingPage() {
  return (
    <PreWorkspaceShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your business</h1>
          <p className="text-sm text-muted-foreground">
            One workspace per business. You can invite your team and connect WhatsApp once it&apos;s
            set up.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <CreateWorkspaceForm />
        </div>
      </div>
    </PreWorkspaceShell>
  );
}
