import { UserX } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Shown when a customer id does not resolve.
 *
 * It exists so the miss renders *inside* the app shell. Without it Next falls back to
 * the root `not-found`, which drops the navigation entirely — from the reader's point
 * of view clicking a stale bookmark would look like being logged out.
 *
 * The copy is careful not to say the customer never existed. This same page answers a
 * deleted customer, a mistyped id, and a record belonging to another workspace, and the
 * three must stay indistinguishable: confirming that an id is real somewhere else is
 * how a tenant boundary gets mapped from the outside.
 */
export default function ContactNotFound() {
  return (
    <EmptyState
      icon={UserX}
      title="We could not find that customer"
      description="The link may be out of date, or the customer may have been removed. Your customer list is up to date."
      action={
        <Button asChild variant="outline">
          <Link href="/contacts">Back to customers</Link>
        </Button>
      }
    />
  );
}
