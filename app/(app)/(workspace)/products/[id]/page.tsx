import { ArrowLeft } from 'lucide-react';
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
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatBand } from '@/components/ui/stat';
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
      <PageHeader
        title={product.name}
        description={headerMeta(product)}
        badges={<ProductStatusBadge status={product.status} />}
        breadcrumb={
          // Pulled left by the button's own padding so the label lines up with the title
          // below it rather than sitting a few pixels inside it.
          <Button asChild variant="ghost" size="sm" className="-ml-2.5 self-start">
            <Link href="/products">
              <ArrowLeft aria-hidden />
              All products
            </Link>
          </Button>
        }
        actions={
          product.can.delete ? (
            <DeleteProductDialog productId={product.id} productName={product.name} />
          ) : undefined
        }
      />

      <Summary product={product} />

      <Card>
        <CardContent className="pt-5">
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
        <CardContent className="pt-5">
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
 * The three facts worth seeing before the forms below: what it costs, whether it is about
 * to run out, and how many sizes it comes in.
 *
 * Status is not among them — it is stated beside the name two lines above, and a fact
 * repeated within one screenful reads as two facts that might disagree. The price and stock
 * cells reuse the catalogue's own badges, so a colour never means one thing here and
 * another there.
 */
function Summary({ product }: { product: ProductDetail }) {
  const sizeCount = product.variants.length;

  return (
    <StatBand label="Product at a glance" columns={3}>
      <Stat label="Price" value={<ProductPrice price={product.price} />} />
      <Stat
        label="Stock"
        value={
          <StockBadge
            tracksStock={product.tracksStock}
            totalAvailable={product.totalAvailable}
            isLowStock={product.isLowStock}
          />
        }
      />
      <Stat
        label="Sizes"
        value={
          sizeCount === 0 ? 'One option' : `${sizeCount} ${sizeCount === 1 ? 'size' : 'sizes'}`
        }
        hint={sizeCount === 0 ? 'Sold as a single item' : undefined}
      />
    </StatBand>
  );
}
