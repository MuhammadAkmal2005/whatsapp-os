import { PackageX } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Shown when an order id does not resolve.
 *
 * Rendered inside the app shell, not via the root `not-found`, so a stale link keeps the
 * navigation in place rather than looking like a logout.
 *
 * The copy does not claim the order never existed. This one page answers a mistyped id and
 * an order belonging to another workspace alike, and the two stay indistinguishable on
 * purpose: confirming an id is real *somewhere else* is exactly how a tenant boundary gets
 * mapped from outside.
 */
export default function OrderNotFound() {
  return (
    <EmptyState
      icon={PackageX}
      title="We could not find that order"
      description="The link may be out of date, or the order may belong to a different workspace. Your order book is up to date."
      action={
        <Button asChild variant="outline">
          <Link href="/orders">Back to orders</Link>
        </Button>
      }
    />
  );
}
