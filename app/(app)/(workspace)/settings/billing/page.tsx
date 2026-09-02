import { redirect } from 'next/navigation';

import { BillingView } from '@/components/settings/billing/billing-view';
import { getWorkspaceBillingSummary } from '@/server/services/subscription/subscription.service';
import { can } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata = { title: 'Billing' };

/**
 * The plan, what it includes, and what has been used against it.
 *
 * Reading the page needs `subscription:read`; changing the plan needs `subscription:manage`, which
 * the view asks for separately. A role that cannot read billing is sent back to settings rather
 * than shown an empty page, because the section list never offered it the link in the first place.
 */
export default async function BillingSettingsPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  if (!can(context, 'subscription:read')) redirect('/settings');

  const billing = await getWorkspaceBillingSummary(context);

  return <BillingView initialData={billing} />;
}
