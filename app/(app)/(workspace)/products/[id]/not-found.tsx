import { PackageX } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Shown when a product id does not resolve.
 *
 * Rendered inside the app shell, not via the root `not-found`, so a stale link keeps the
 * navigation in place rather than looking like a logout.
 *
 * The copy does not claim the product never existed. This one page answers a deleted
 * product, a mistyped id, and a product belonging to another workspace, and the three
 * stay indistinguishable on purpose: confirming an id is real *somewhere else* is exactly
 * how a tenant boundary gets mapped from outside.
 */
export default function ProductNotFound() {
  return (
    <EmptyState
      icon={PackageX}
      title="We could not find that product"
      description="The link may be out of date, or the product may have been removed. Your catalogue is up to date."
      action={
        <Button asChild variant="outline">
          <Link href="/products">Back to products</Link>
        </Button>
      }
    />
  );
}
