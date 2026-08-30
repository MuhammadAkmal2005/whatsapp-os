import 'server-only';

import { env } from '@/config/env';
import { getPlan, type PlanKey } from '@/config/plans';
import { BusinessRuleError } from '@/server/errors';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import { changeSubscriptionPlan } from '../subscription/subscription.service';

export async function processCheckoutOrDowngrade(
  ctx: TenantContext,
  planKey: PlanKey,
): Promise<{ redirectUrl?: string }> {
  requirePermission(ctx, 'subscription:manage');

  const plan = getPlan(planKey);

  // If price is zero (downgrade to Free), we immediately process the change
  // directly without a payment checkout.
  if (plan.priceMinor === 0) {
    await changeSubscriptionPlan(ctx, { planKey });
    return {};
  }

  // Paid plans require checkout session creation via a provider.
  if (env.PAYMENT_PROVIDER === 'stripe') {
    // A real integration would use the stripe SDK here.
    throw new BusinessRuleError('Stripe checkout is not implemented in this unit.');
  }

  // Mock Provider Flow
  // Creates a mock checkout URL for testing that can complete or fail deterministically.
  const mockUrl = `/api/billing/mock/checkout?workspaceId=${ctx.workspaceId}&planKey=${planKey}`;
  return { redirectUrl: mockUrl };
}
