import { DashboardSkeleton } from '@/components/dashboard/dashboard-skeleton';

/**
 * Fallback for the workspace content area while a page's server data resolves.
 *
 * It renders inside the app shell — the sidebar and header are already painted — and covers the
 * group as a whole: the first paint after signing in, and any child segment that has no loading
 * module of its own. The dashboard is the route you land on, so this draws the dashboard's shape.
 *
 * The dashboard also has its own `loading.tsx` now, which is what this file cannot do: a parent's
 * loading module only renders for the segment being replaced, so it never appears when you click
 * between two screens inside the group. Both render `DashboardSkeleton`.
 */
export default function WorkspaceLoading() {
  return <DashboardSkeleton label="Loading your workspace…" />;
}
