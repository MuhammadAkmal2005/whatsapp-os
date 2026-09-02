import { Lock } from 'lucide-react';
import { redirect } from 'next/navigation';

import { firstAvailableSettingsHref } from '@/components/app-shell/settings-nav-config';
import { EmptyState } from '@/components/ui/empty-state';
import { can } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';

/**
 * `/settings` has no content of its own — it forwards to the first section the
 * caller can actually open. Which section that is depends on their role, so the
 * destination is computed rather than fixed.
 *
 * A role with no settings access at all (an AGENT, today) sees an explanation
 * instead of being bounced somewhere it will be refused again.
 */
export default async function SettingsIndexPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const destination = firstAvailableSettingsHref((permission) => can(context, permission));
  if (destination) redirect(destination);

  return (
    <EmptyState
      icon={Lock}
      title="No settings available for your role"
      description="Your role focuses on customer conversations. Ask an owner or admin if you need access to business settings."
    />
  );
}
