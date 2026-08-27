import { ArrowLeft, Package } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import {
  ProductPrice,
  ProductStatusBadge,
  StockBadge,
} from '@/components/products/product-badges';
import { DeleteProductDialog } from '@/components/products/delete-product-dialog';
import { EditProductForm } from '@/components/products/edit-product-form';
import { ProductVariants } from '@/components/products/product-variants';
import { StockControls } from '@/components/products/stock-controls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { coerceCurrency } from '@/lib/money';
import { NotFoundError } from '@/server/errors';
import { getProduct, getProducts, type ProductDetail } from '@/server/services/product/product.service';
import type { TenantContext } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listProductsSchema, productId as productIdSchema } from '@/server/validation/product';

type RouteParams = Promise<{ id: string }>;

/**
 * Loaded once per request. Next runs `generateMetadata` and the page in the same request
 * and both need the product; Prisma is not deduplicated the way `fetch` is, so without
 * `cache` the detail query would run twice. Keyed on the id both callers pass.
 */
const loadProduct = cache(async (context: TenantContext, id: string) =>
  getProduct(context, id),
);

export async function generateMetadata({ params }: { params: RouteParams }) {
  const context = await getTenantContext();
  if (!context) return { title: 'Product' };

  const parsed = productIdSchema.safeParse((await params).id);
  if (!parsed.success) return { title: 'Product not found' };

  // The title is cosmetic and the component renders the real 404, so a failed load must
  // not throw here — Next calls this alongside the page, and a throw would surface as an
  // error boundary rather than a not-found.
  try {
    const product = await loadProduct(context, parsed.data);
    return { title: product.name };
  } catch {
    return { title: 'Product not found' };
  }
}

export default async function ProductDetailPage({ params }: { params: RouteParams }) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  // A malformed id is a 404, not a 500: without this the string reaches Prisma, which
  // rejects it as an invalid uuid and turns a mistyped URL into an error page.
  const parsed = productIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  let product: ProductDetail;
  try {
    product = await loadProduct(context, parsed.data);
  } catch (error) {
    // A product in another workspace throws the same NotFoundError as one that does not
    // exist, and the two are meant to be indistinguishable from out here.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  // Categories for the edit form come from the catalogue service — one query more than
  // strictly needed, and worth it to avoid a second catalogue read kept in step by hand.
  // Same call the new-product page makes.
  const catalogue = await getProducts(context, listProductsSchema.parse({ limit: 1 }));
  const currency = coerceCurrency(product.currency);

  const hasVariants = product.variants.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/products">
            <ArrowLeft className="size-4" aria-hidden />
            All products
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {/* A neutral tile, not a photo: image upload is not built yet, and a broken
              thumbnail would read worse than an honest placeholder. */}
          <span
            className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            aria-hidden
          >
            <Package className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                {product.name}
              </h1>
              <ProductStatusBadge status={product.status} />
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">{headerMeta(product)}</p>
          </div>
        </div>

        {product.can.delete ? (
          <DeleteProductDialog productId={product.id} productName={product.name} />
        ) : null}
      </div>

      <Summary product={product} />

      <Card>
        <CardContent className="pt-6">
          <EditProductForm
            product={product}
            categories={catalogue.categories}
            canUpdate={product.can.update}
          />
        </CardContent>
      </Card>

      {/* Product-level stock only when there are no sizes. Once a product has variants it
          is counted per size, inside the section below, and a figure here as well would be
          stock the shop does not have. Absent entirely for a made-to-order product. */}
      {!hasVariants && product.tracksStock && product.ownStock ? (
        <Card>
          <CardHeader>
            <CardTitle>Stock</CardTitle>
            <CardDescription>
              How many you have. Your AI will not sell past this, and warns you when it runs low.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StockControls
              productId={product.id}
              variantId=""
              available={product.ownStock.available}
              reserved={product.ownStock.reserved}
              lowStockThreshold={product.ownStock.lowStockThreshold}
              canEdit={product.can.editStock}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <ProductVariants
            productId={product.id}
            variants={product.variants}
            currency={currency}
            tracksStock={product.tracksStock}
            canEditVariants={product.can.editVariants}
            canEditStock={product.can.editStock}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** The code and category under the name, joined only when present — a one-off may have
 *  neither, and an empty line would leave the header ragged. */
function headerMeta(product: ProductDetail): string {
  const parts = [product.sku, product.categoryName].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'No code or category yet';
}

/**
 * The four figures worth seeing before scrolling: what it costs, whether it is about to
 * run out, how many sizes it comes in, and whether the AI may sell it. The stock and status
 * cells reuse the same badges the catalogue list uses, so a colour never means one thing
 * here and another there.
 */
function Summary({ product }: { product: ProductDetail }) {
  const sizeCount = product.variants.length;

  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Price</dt>
        <dd>
          <ProductPrice price={product.price} />
        </dd>
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stock</dt>
        <dd>
          <StockBadge
            tracksStock={product.tracksStock}
            totalAvailable={product.totalAvailable}
            isLowStock={product.isLowStock}
          />
        </dd>
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sizes</dt>
        <dd className="text-lg font-semibold text-foreground">
          {sizeCount === 0 ? 'One option' : `${sizeCount} ${sizeCount === 1 ? 'size' : 'sizes'}`}
        </dd>
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt>
        <dd>
          <ProductStatusBadge status={product.status} />
        </dd>
      </div>
    </dl>
  );
}
