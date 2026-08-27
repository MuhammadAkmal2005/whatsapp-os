import { Package, PackageX, Plus } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ProductFilters } from '@/components/products/product-filters';
import { ProductList } from '@/components/products/product-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { firstParam } from '@/lib/search-params';
import { getProducts } from '@/server/services/product/product.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listProductsSchema } from '@/server/validation/product';

export const metadata = { title: 'Products' };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The product catalogue.
 *
 * Filters come from the URL and are validated with the same schema the actions use, so
 * a hand-edited query string cannot reach the repository with a status that is not a
 * status. `limit` is deliberately not read from the URL: it decides how much work
 * Postgres does per request, not something a visitor should be able to turn up.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const params = await searchParams;
  const parsed = listProductsSchema.safeParse({
    search: firstParam(params.search),
    status: firstParam(params.status),
    categoryId: firstParam(params.categoryId),
    lowStock: firstParam(params.lowStock),
    cursor: firstParam(params.cursor),
  });

  // A stale or hand-edited link falls back to the unfiltered catalogue rather than an
  // error page. The person wanted to see their products; showing all of them beats a
  // validation message about a query string they did not type.
  const input = parsed.success ? parsed.data : listProductsSchema.parse({});
  const page = await getProducts(context, input);

  const isFiltered = Boolean(input.search || input.status || input.categoryId || input.lowStock);
  const atLimit = page.usage.limit !== null && page.usage.used >= page.usage.limit;

  const addButton = (
    <Button asChild>
      <Link href="/products/new">
        <Plus className="size-4" aria-hidden />
        Add product
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What your AI can offer and your customers can order. {summarise(page.usage)}
          </p>
        </div>
        {page.can.create && !atLimit ? addButton : null}
      </div>

      {atLimit ? (
        <Alert variant="warning">
          <Package className="size-4" aria-hidden />
          <AlertTitle>You have reached your plan&apos;s product limit</AlertTitle>
          <AlertDescription>
            Your plan includes {page.usage.limit} products. Existing products keep working and
            nothing is deleted, but new ones cannot be added until you upgrade.{' '}
            <Link href="/settings/billing" className="font-medium underline underline-offset-4">
              See plans
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {page.usage.used > 0 ? <ProductFilters categories={page.categories} /> : null}

      {page.usage.used === 0 ? (
        <EmptyState
          icon={Package}
          title="Your catalogue is empty"
          description="Add your products so your AI can quote prices, check sizes and take orders. Start with your best-seller — a name, a price and how many you have is enough."
          action={page.can.create ? addButton : undefined}
          secondaryAction={
            page.can.create ? undefined : 'Ask an owner or manager to add your products.'
          }
        />
      ) : page.products.length === 0 ? (
        // Two ways to reach an empty page with a non-empty catalogue: filters that match
        // nothing, or a cursor from a link whose rows have since moved. Both recover with
        // the same click, but saying which one happened is the difference between a dead
        // end and an explanation.
        <EmptyState
          icon={PackageX}
          title={isFiltered ? 'No products match these filters' : 'Nothing left to show'}
          description={
            isFiltered
              ? 'Try a different status or category, or clear the search to see everything again.'
              : 'This page is past the end of your catalogue. It may have changed since this link was made.'
          }
          action={
            <Button asChild variant="outline">
              <Link href="/products">{isFiltered ? 'Clear filters' : 'Back to the start'}</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ProductList products={page.products} />
          </CardContent>
        </Card>
      )}

      {page.nextCursor || input.cursor ? (
        <Pagination cursor={page.nextCursor} params={params} showFirst={Boolean(input.cursor)} />
      ) : null}
    </div>
  );
}

function summarise(usage: { used: number; limit: number | null }): string {
  const noun = usage.used === 1 ? 'product' : 'products';
  if (usage.limit === null) return `${usage.used} ${noun}.`;
  return `${usage.used} of ${usage.limit} ${noun} on your plan.`;
}

/**
 * Cursor pagination, so a catalogue that changes while it is being read never shows the
 * same product on two pages. There is no "previous": the browser's back button is the
 * previous page, and it is the control people already reach for.
 */
function Pagination({
  cursor,
  params,
  showFirst,
}: {
  cursor: string | null;
  params: SearchParams;
  showFirst: boolean;
}) {
  const preserved = new URLSearchParams();
  for (const key of ['search', 'status', 'categoryId', 'lowStock']) {
    const value = firstParam(params[key]);
    if (value) preserved.set(key, value);
  }

  const firstHref = preserved.toString() ? `/products?${preserved.toString()}` : '/products';
  const nextParams = new URLSearchParams(preserved.toString());
  if (cursor) nextParams.set('cursor', cursor);

  return (
    <div className="flex items-center justify-between gap-3">
      {showFirst ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={firstHref}>Back to the start</Link>
        </Button>
      ) : (
        <span />
      )}
      {cursor ? (
        <Button asChild variant="outline" size="sm">
          <Link href={`/products?${nextParams.toString()}`}>Show more products</Link>
        </Button>
      ) : null}
    </div>
  );
}
