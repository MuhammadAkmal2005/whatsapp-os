'use server';

import { formErrorFrom } from '@/server/actions/action-helpers';
import {
  cancelSubscription,
  changeSubscriptionPlan,
  getSubscriptionOverview,
  getWorkspaceBillingSummary,
  resumeSubscription,
  type WorkspaceBillingSummaryDTO,
  type WorkspaceSubscriptionOverviewDTO,
} from '@/server/services/subscription/subscription.service';
import { processCheckoutOrDowngrade } from '@/server/services/billing/checkout.service';
import { requireTenantContext } from '@/server/tenancy/resolve';
import { changePlanSchema, type ChangePlanInput } from '@/server/validation/subscription';

export type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Fetches the current workspace subscription overview and plan details.
 * Guarded by `subscription:read` (ADMIN, OWNER).
 */
export async function fetchSubscriptionAction(): Promise<
  ActionResponse<WorkspaceSubscriptionOverviewDTO>
> {
  try {
    const context = await requireTenantContext();
    const data = await getSubscriptionOverview(context);
    return { success: true, data };
  } catch (error) {
    const safe = formErrorFrom(error);
    return { success: false, error: safe.message ?? 'Failed to fetch subscription.' };
  }
}

/**
 * Fetches the complete billing overview including active subscription, full plan catalogue,
 * quota metrics usage, and caller permissions for the billing dashboard UI.
 * Guarded by `subscription:read` (ADMIN, OWNER).
 */
export async function fetchBillingOverviewAction(): Promise<
  ActionResponse<WorkspaceBillingSummaryDTO>
> {
  try {
    const context = await requireTenantContext();
    const data = await getWorkspaceBillingSummary(context);
    return { success: true, data };
  } catch (error) {
    const safe = formErrorFrom(error);
    return { success: false, error: safe.message ?? 'Failed to fetch billing overview.' };
  }
}

/**
 * Changes the active workspace plan (upgrade / downgrade / switch to free).
 * Guarded by `subscription:manage` (OWNER only).
 */
export async function changePlanAction(
  rawInput: ChangePlanInput,
): Promise<ActionResponse<{ redirectUrl?: string }>> {
  try {
    const context = await requireTenantContext();
    const parsed = changePlanSchema.parse(rawInput);
    const data = await processCheckoutOrDowngrade(context, parsed.planKey);
    return { success: true, data };
  } catch (error) {
    const safe = formErrorFrom(error);
    return { success: false, error: safe.message ?? 'Failed to change plan.' };
  }
}

/**
 * Schedules subscription cancellation at the end of current billing period.
 * Guarded by `subscription:manage` (OWNER only).
 */
export async function cancelSubscriptionAction(): Promise<
  ActionResponse<WorkspaceSubscriptionOverviewDTO>
> {
  try {
    const context = await requireTenantContext();
    const data = await cancelSubscription(context);
    return { success: true, data };
  } catch (error) {
    const safe = formErrorFrom(error);
    return { success: false, error: safe.message ?? 'Failed to cancel subscription.' };
  }
}

/**
 * Resumes a subscription scheduled for cancellation at period end.
 * Guarded by `subscription:manage` (OWNER only).
 */
export async function resumeSubscriptionAction(): Promise<
  ActionResponse<WorkspaceSubscriptionOverviewDTO>
> {
  try {
    const context = await requireTenantContext();
    const data = await resumeSubscription(context);
    return { success: true, data };
  } catch (error) {
    const safe = formErrorFrom(error);
    return { success: false, error: safe.message ?? 'Failed to resume subscription.' };
  }
}
