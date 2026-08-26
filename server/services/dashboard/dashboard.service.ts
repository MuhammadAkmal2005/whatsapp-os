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
  getOnboardingState,
  type OnboardingState,
} from '@/server/repositories/workspace.repository';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';

export type DashboardData = {
  metrics: DashboardMetrics;
  onboarding: OnboardingState;
  activity: ActivityEntry[];
};

export async function getDashboardData(context: TenantContext): Promise<DashboardData> {
  requirePermission(context, 'analytics:read');

  const [metrics, onboarding, activity] = await Promise.all([
    getDashboardMetrics(prisma, context.workspaceId),
    getOnboardingState(prisma, context.workspaceId),
    getRecentActivity(prisma, context.workspaceId),
  ]);

  return { metrics, onboarding, activity };
}
