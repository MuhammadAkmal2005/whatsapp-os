/**
 * Dashboard metrics.
 *
 * Every count here is scoped to one workspace, injected from the caller's
 * `workspaceId` — never a value from the request. The numbers are real counts
 * from real tables, so a brand-new workspace shows honest zeros and populated
 * ones show live figures the moment the seed or the first order lands. Nothing
 * here is invented for the sake of a full-looking dashboard.
 *
 * The reads run concurrently: a dashboard is a fan-out of independent counts,
 * and issuing them in parallel keeps first paint quick.
 */

import 'server-only';

import type { Db } from '@/db/prisma';
import { countLowStockProducts } from '@/server/repositories/inventory.repository';

export type DashboardMetrics = {
  openConversations: number;
  totalConversations: number;
  aiEnabledConversations: number;
  /** Conversations a person took over that are still live. All-time handoffs is a
   *  historical fact, not something anyone can act on; this is the working number the
   *  dashboard surfaces under "needs your attention". */
  openHandoffs: number;
  totalContacts: number;
  newContacts30d: number;
  leads: number;
  totalProducts: number;
  /** Products with at least one variant at or below *its own* reorder level — the same
   *  question, asked the same way, as the catalogue's low-stock filter. The two have to
   *  agree, because the dashboard links straight to that filter. */
  lowStockItems: number;
  totalOrders: number;
  pendingOrders: number;
  ordersThisMonth: number;
  /** Integer minor units. Paid orders placed this calendar month. */
  revenueThisMonthMinor: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getDashboardMetrics(
  db: Db,
  workspaceId: string,
  now: Date = new Date(),
): Promise<DashboardMetrics> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    openConversations,
    totalConversations,
    aiEnabledConversations,
    openHandoffs,
    totalContacts,
    newContacts30d,
    leads,
    totalProducts,
    lowStockItems,
    totalOrders,
    pendingOrders,
    ordersThisMonth,
    revenueAggregate,
  ] = await Promise.all([
    db.conversation.count({ where: { workspaceId, status: 'OPEN' } }),
    db.conversation.count({ where: { workspaceId } }),
    db.conversation.count({ where: { workspaceId, aiEnabled: true } }),
    db.conversation.count({
      where: { workspaceId, handoffAt: { not: null }, status: { in: ['OPEN', 'PENDING'] } },
    }),
    db.contact.count({ where: { workspaceId, deletedAt: null } }),
    db.contact.count({ where: { workspaceId, deletedAt: null, createdAt: { gte: thirtyDaysAgo } } }),
    db.contact.count({ where: { workspaceId, deletedAt: null, status: 'LEAD' } }),
    db.product.count({ where: { workspaceId, deletedAt: null } }),
    countLowStockProducts(db, workspaceId),
    db.order.count({ where: { workspaceId, deletedAt: null } }),
    db.order.count({ where: { workspaceId, deletedAt: null, status: 'PENDING' } }),
    db.order.count({ where: { workspaceId, deletedAt: null, createdAt: { gte: monthStart } } }),
    db.order.aggregate({
      _sum: { totalMinor: true },
      where: { workspaceId, deletedAt: null, paymentStatus: 'PAID', createdAt: { gte: monthStart } },
    }),
  ]);

  return {
    openConversations,
    totalConversations,
    aiEnabledConversations,
    openHandoffs,
    totalContacts,
    newContacts30d,
    leads,
    totalProducts,
    lowStockItems,
    totalOrders,
    pendingOrders,
    ordersThisMonth,
    revenueThisMonthMinor: revenueAggregate._sum.totalMinor ?? 0,
  };
}

export type ActivityEntry = {
  id: string;
  action: string;
  actorType: string;
  resourceType: string | null;
  createdAt: Date;
};

/** Recent audit-log entries for the activity feed. Tenant-scoped; newest first. */
export async function getRecentActivity(
  db: Db,
  workspaceId: string,
  limit = 8,
): Promise<ActivityEntry[]> {
  const rows = await db.auditLog.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, action: true, actorType: true, resourceType: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorType: row.actorType,
    resourceType: row.resourceType,
    createdAt: row.createdAt,
  }));
}
