import { ArrowLeft, Package } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CreateProductForm } from '@/components/products/create-product-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getProducts } from '@/server/services/product/product.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listProductsSchema } from '@/server/validation/product';

export const metadata = { title: 'Add product' };

/**
 * The new-product page.
 *
 * It reuses `getProducts` — with the smallest page it can ask for — to learn three
 * things it needs before showing a form: whether this member may create products, the
 * categories to offer, and whether the workspace is at its plan limit. That is one
 * query more than strictly necessary, and it is worth it to avoid a second catalogue
 * service that would have to be kept in step with the first.
 */
export default async function NewProductPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const page = await getProducts(context, listProductsSchema.parse({ limit: 1 }));

  // The list page hides the "Add product" button for a member without the permission,
  // so anyone here typed the URL. The action would refuse them regardless — this just
  // means they meet an honest wall instead of a form that fails on submit.
  if (!page.can.create) redirect('/products');

  const atLimit = page.usage.limit !== null && page.usage.used >= page.usage.limit;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/products"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Products
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Add a product</h1>
        <p className="text-sm text-muted-foreground">
          A name, a price and how many you have is enough to start. You can add sizes and photos
          from the product page afterwards.
        </p>
      </div>

      {atLimit ? (
        <Alert variant="warning">
          <Package className="size-4" aria-hidden />
          <AlertTitle>You have reached your plan&apos;s product limit</AlertTitle>
          <AlertDescription>
            Your plan includes {page.usage.limit} products. Upgrade to add more, or archive one you
            no longer sell.{' '}
            <Link href="/settings/billing" className="font-medium underline underline-offset-4">
              See plans
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <CreateProductForm categories={page.categories} currency={context.currency} />
          </CardContent>
        </Card>
      )}

      {atLimit ? (
        <Button asChild variant="outline" className="w-fit">
          <Link href="/products">Back to products</Link>
        </Button>
      ) : null}
    </div>
  );
}
