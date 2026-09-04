/**
 * Dashboard read service.
 *
 * The dashboard page is a Server Component in the routing layer, so it may not
 * touch Prisma. It calls this service instead, which holds the client only to
 * hand it to the repositories and fans the independent reads out concurrently.
 *
 * Authorization is enforced here, server-side: every workspace role holds
 * `analytics:read`, but the check is real rather than assumed, so a future role
 * that loses it is refused without the page needing to change.
 */

import 'server-only';

import { prisma } from '@/db/prisma';
import {
  getDashboardMetrics,
  getRecentActivity,
  type ActivityEntry,
  type DashboardMetrics,
} from '@/server/repositories/metrics.repository';
import {
  requirePermission,
  type TenantContext,
  type WorkspaceOnboardingState,
} from '@/server/tenancy/context';

export type DashboardData = {
  metrics: DashboardMetrics;
  onboarding: WorkspaceOnboardingState;
  activity: ActivityEntry[];
};

export async function getDashboardData(context: TenantContext): Promise<DashboardData> {
  requirePermission(context, 'analytics:read');

  // Onboarding progress is not fetched: it arrives on the context, selected by
  // the membership read that proved access to this workspace in the first place.
  const [metrics, activity] = await Promise.all([
    getDashboardMetrics(prisma, context.workspaceId),
    getRecentActivity(prisma, context.workspaceId),
  ]);

  return { metrics, onboarding: context.onboarding, activity };
}
