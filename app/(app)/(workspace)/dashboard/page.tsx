import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { Clock, Headset, MessageSquare, PackageX, ShoppingBag, Users, Wallet } from 'lucide-react';

import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { StatCard, type StatTone } from '@/components/dashboard/stat-card';
import { DEFAULT_LOW_STOCK_THRESHOLD } from '@/config/constants';
import { formatMoney, money } from '@/lib/money';
import { cn } from '@/lib/utils';
import { getDashboardData } from '@/server/services/dashboard/dashboard.service';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata: Metadata = { title: 'Dashboard' };

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'there';
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

type AlertCard = {
  label: string;
  value: string;
  icon: LucideIcon;
  hint: string;
  tone: StatTone;
};

/**
 * The workspace home. Every figure is a real, tenant-scoped count from the
 * dashboard service — a brand-new workspace shows honest zeros, not invented
 * numbers to look busy. The page re-resolves its own `TenantContext` (memoised,
 * so it shares the layout's lookup) rather than trusting anything from the
 * client, and it never links a card to a screen that does not exist yet.
 */
export default async function DashboardPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const { metrics, onboarding, activity } = await getDashboardData(context);

  const revenue = formatMoney(money(metrics.revenueThisMonthMinor, context.currency));

  // Attention cards appear only when there is something to act on — the
  // dashboard never shows a row of reassuring zeros dressed up as alerts.
  const alerts: AlertCard[] = [];
  if (metrics.pendingOrders > 0) {
    alerts.push({
      label: 'Pending orders',
      value: String(metrics.pendingOrders),
      icon: Clock,
      hint: 'Waiting to be processed',
      tone: 'warning',
    });
  }
  if (metrics.lowStockItems > 0) {
    alerts.push({
      label: 'Low on stock',
      value: String(metrics.lowStockItems),
      icon: PackageX,
      hint: `${DEFAULT_LOW_STOCK_THRESHOLD} or fewer left`,
      tone: 'danger',
    });
  }
  if (metrics.humanHandoffs > 0) {
    alerts.push({
      label: 'Handed to you',
      value: String(metrics.humanHandoffs),
      icon: Headset,
      hint: 'Conversations taken over from the AI',
      tone: 'warning',
    });
  }

  const showChecklist = onboarding.completedAt === null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {firstName(context.user.name)}
        </h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s happening at {context.workspaceName} today.
        </p>
      </header>

      <section aria-label="Key metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Revenue this month"
          value={revenue}
          icon={Wallet}
          hint={`${metrics.ordersThisMonth} ${plural(metrics.ordersThisMonth, 'order')} this month`}
        />
        <StatCard
          label="Orders"
          value={String(metrics.totalOrders)}
          icon={ShoppingBag}
          hint={`${metrics.ordersThisMonth} this month`}
        />
        <StatCard
          label="Open conversations"
          value={String(metrics.openConversations)}
          icon={MessageSquare}
          hint={`${metrics.totalConversations} total`}
        />
        <StatCard
          label="Customers"
          value={String(metrics.totalContacts)}
          icon={Users}
          hint={`${metrics.newContacts30d} new in 30 days`}
        />
      </section>

      {alerts.length > 0 ? (
        <section aria-label="Needs attention" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Needs attention</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.map((alert) => (
              <StatCard
                key={alert.label}
                label={alert.label}
                value={alert.value}
                icon={alert.icon}
                hint={alert.hint}
                tone={alert.tone}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className={cn('grid grid-cols-1 gap-6', showChecklist && 'lg:grid-cols-3')}>
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
