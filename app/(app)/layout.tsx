import { redirect } from 'next/navigation';

import { getUserContext } from '@/server/tenancy/resolve';

/**
 * The signed-in boundary for everything under the app.
 *
 * The edge middleware only checks that a session cookie is present; this is
 * where the token is actually validated against the database. A forged or
 * expired cookie gets past the edge and is turned away here. This layout stays
 * deliberately chrome-free: the pages it wraps directly (onboarding, the
 * workspace picker) centre their own content, and the nested `(workspace)`
 * layout adds the sidebar shell — nesting a header here would double it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getUserContext();
  if (!context) redirect('/login');

  return <div className="min-h-dvh bg-background">{children}</div>;
}
