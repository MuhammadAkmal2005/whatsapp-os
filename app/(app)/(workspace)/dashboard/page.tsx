import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Clock, Headset, PackageX } from 'lucide-react';

import { NeedsAttention, type AttentionItem } from '@/components/dashboard/needs-attention';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatBand } from '@/components/ui/stat';
import { formatMoney, money } from '@/lib/money';
import { cn } from '@/lib/utils';
import { getDashboardData } from '@/server/services/dashboard/dashboard.service';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata: Metadata = { title: 'Dashboard' };

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'there';
}

/**
 * The workspace home.
 *
 * Ordered by what a shop owner opens it to find out. First *what needs me* — the worklist,
 * which is absent entirely when nothing does. Then *how are we doing* — one headline figure
 * with its supporting counts, sharing a single surface so they read as one set rather than
 * as five things competing. Then setup progress and recent activity.
 *
 * Every figure is a real, tenant-scoped count from the dashboard service, so a brand-new
 * workspace shows honest zeros rather than invented numbers to look busy. The page
 * re-resolves its own `TenantContext` (memoised, so it shares the layout's lookup) rather
 * than trusting anything from the client, and a figure links to a screen only when that
 * screen shows exactly the same set of records.
 */
export default async function DashboardPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const { metrics, onboarding, activity } = await getDashboardData(context);

  const revenue = formatMoney(money(metrics.revenueThisMonthMinor, context.currency));

  // Ordered by who is waiting: a customer whose conversation is sitting with a person,
  // then a customer waiting for their order to be confirmed, then stock that will cost
  // sales but is not blocking anyone yet. Tone says what happens if it is ignored, which
  // is why the last row is the loudest one.
  const attention: AttentionItem[] = [];
  if (metrics.openHandoffs > 0) {
    attention.push({
      label: 'Waiting for a person',
      count: metrics.openHandoffs,
      detail: 'Taken over from your AI and still open',
      icon: Headset,
      tone: 'warning',
    });
  }
  if (metrics.pendingOrders > 0) {
    attention.push({
      label: 'Orders to confirm',
      count: metrics.pendingOrders,
      detail: 'Placed, but not confirmed yet',
      icon: Clock,
      tone: 'warning',
      href: '/orders?status=PENDING',
    });
  }
  if (metrics.lowStockItems > 0) {
    attention.push({
      label: 'Running low on stock',
      count: metrics.lowStockItems,
      detail: 'At or below the reorder level you set',
      icon: PackageX,
      tone: 'danger',
      href: '/products?lowStock=true',
    });
  }

  const showChecklist = onboarding.completedAt === null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome back, ${firstName(context.user.name)}`}
        description={`Here's what's happening at ${context.workspaceName} today.`}
      />

      <NeedsAttention items={attention} />

      <StatBand columns={4} label="Key figures">
        {/* The headline spans the band. Revenue is the one number a shop owner came to
            see, and giving it the same weight as a contact count is what made the old
            four-up grid read as a wall. It does not link: no screen shows paid revenue
            for this calendar month specifically, and a link to an approximation of a
            figure is worse than no link at all. */}
        <Stat
          emphasis="lead"
          className="sm:col-span-2 lg:col-span-4"
          label="Revenue this month"
          value={revenue}
          hint="From orders marked paid"
        />
        <Stat
          label="Orders"
          value={metrics.totalOrders.toLocaleString()}
          hint={`${metrics.ordersThisMonth.toLocaleString()} this month`}
          href="/orders"
        />
        <Stat
          label="Open conversations"
          value={metrics.openConversations.toLocaleString()}
          hint={`${metrics.totalConversations.toLocaleString()} in total`}
          href="/conversations?status=OPEN"
        />
        <Stat
          label="Customers"
          value={metrics.totalContacts.toLocaleString()}
          hint={`${metrics.newContacts30d.toLocaleString()} new in the last 30 days`}
          href="/contacts"
        />
        <Stat
          label="Leads"
          value={metrics.leads.toLocaleString()}
          hint="Also counted in customers"
          href="/contacts?status=LEAD"
        />
      </StatBand>

      <div className={cn('grid grid-cols-1 gap-4', showChecklist && 'lg:grid-cols-3')}>
        {showChecklist ? (
          // DOM order puts the checklist first so mobile leads with the actionable
          // card; on desktop it moves to the right rail beside the activity feed.
          <div className="lg:order-2 lg:col-span-1">
            <OnboardingChecklist completedSteps={onboarding.completedSteps} />
          </div>
        ) : null}
        <div className={cn(showChecklist && 'lg:order-1 lg:col-span-2')}>
          <RecentActivity entries={activity} />
        </div>
      </div>
    </div>
  );
}
