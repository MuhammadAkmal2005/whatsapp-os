import { DashboardSkeleton } from '@/components/dashboard/dashboard-skeleton';

/**
 * Shown while the dashboard's figures are queried.
 *
 * The dashboard is the most-clicked destination in the sidebar and it had no loading boundary of
 * its own, which is worse than it sounds: Next decides a prefetch's payload from the loading
 * modules in the *changing* segment's subtree, so with none here it sent router state alone,
 * rendered the segment without a Suspense wrapper, and left the previous screen on display —
 * looking frozen — until the data arrived. The parent `(workspace)/loading.tsx` cannot stand in,
 * because a loading module only renders for the segment being replaced.
 */
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
