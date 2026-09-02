import { ShoppingBag, PackageX, Plus } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { OrderFilters } from '@/components/orders/order-filters';
import { OrderList } from '@/components/orders/order-list';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CursorPagination } from '@/components/ui/cursor-pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { listOrders } from '@/server/services/order/order.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { orderFiltersSchema } from '@/server/validation/order';

export const metadata = { title: 'Orders' };

/** The filters that survive paging. `cursor` is handled by the pagination footer itself. */
const PRESERVED_FILTERS = ['search', 'status', 'paymentStatus'] as const;

/**
 * The order book.
 *
 * Filters come from the URL and are validated with the same schema the actions use, so a
 * hand-edited query string cannot reach the repository with a status that is not a status.
 * `limit` is deliberately not read from the URL: it decides how much work Postgres does
 * per request, not something a visitor should be able to turn up.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const params = await searchParams;
  const parsed = orderFiltersSchema.safeParse({
    search: firstParam(params.search),
    status: firstParam(params.status),
    paymentStatus: firstParam(params.paymentStatus),
    cursor: firstParam(params.cursor),
  });

  // A stale or hand-edited link falls back to the unfiltered book rather than an error
  // page. The person wanted to see their orders; showing all of them beats a validation
  // message about a query string they did not type.
  const input = parsed.success ? parsed.data : orderFiltersSchema.parse({});
  const page = await listOrders(context, input);

  const totalOrders = Object.values(page.statusCounts).reduce((sum, count) => sum + count, 0);
  const isFiltered = Boolean(input.search || input.status || input.paymentStatus);

  const addButton = (
    <Button asChild>
      <Link href="/orders/new">
        <Plus aria-hidden />
        New order
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        description={`Every order your shop takes, from placed to delivered. ${summarise(totalOrders)}`}
        actions={page.can.create && totalOrders > 0 ? addButton : undefined}
      />

      {totalOrders > 0 ? <OrderFilters /> : null}

      {totalOrders === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No orders yet"
          description="When a customer places an order — through your AI on WhatsApp, or written up here by you — it shows up in this book so you can track it from placed to delivered."
          action={page.can.create ? addButton : undefined}
          secondaryAction={
            page.can.create ? undefined : 'Ask an owner or manager to record your first order.'
          }
        />
      ) : page.orders.length === 0 ? (
        // Two ways to reach an empty page with a non-empty book: filters that match nothing,
        // or a cursor from a link whose rows have since moved. Both recover with the same
        // click, but saying which one happened is the difference between a dead end and an
        // explanation.
        <EmptyState
          icon={PackageX}
          title={isFiltered ? 'No orders match these filters' : 'Nothing left to show'}
          description={
            isFiltered
              ? 'Try a different status or payment state, or clear the search to see every order again.'
              : 'This page is past the end of your order book. It may have changed since this link was made.'
          }
          action={
            <Button asChild variant="outline">
              <Link href="/orders">{isFiltered ? 'Clear filters' : 'Back to the start'}</Link>
            </Button>
          }
        />
      ) : (
        // `overflow-hidden` so the heading row's sunken fill is clipped by the card's
        // corners instead of squaring them off.
        <Card className="overflow-hidden">
          <OrderList orders={page.orders} />
          <CursorPagination
            basePath="/orders"
            params={params}
            preserve={PRESERVED_FILTERS}
            cursor={page.nextCursor}
            isPastFirstPage={Boolean(input.cursor)}
            itemsLabel="orders"
          />
        </Card>
      )}
    </div>
  );
}

function summarise(total: number): string {
  if (total === 0) return 'Your first order will appear here.';
  return `${total} ${total === 1 ? 'order' : 'orders'} so far.`;
}
