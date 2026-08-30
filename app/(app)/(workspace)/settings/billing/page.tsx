import { redirect } from 'next/navigation';
import { can } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';
import { getWorkspaceBillingSummary } from '@/server/services/subscription/subscription.service';
import { BillingView } from '@/components/settings/billing/billing-view';

export const metadata = { title: 'Billing Settings' };

/**
 * Workspace Billing & Subscription Management Settings Page.
 *
 * Scoped by `subscription:read` (ADMIN, OWNER).
 * Plan mutations are further guarded by `subscription:manage` (OWNER).
 */
export default async function BillingSettingsPage() {
  const context = await getTenantContext();
  if (!context) {
    redirect('/select-workspace');
  }

  if (!can(context, 'subscription:read')) {
    redirect('/settings');
  }

  const billingData = await getWorkspaceBillingSummary(context);

  return <BillingView initialData={billingData} />;
}
