import Link from 'next/link';
import { BarChart3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * The analytics screen before there is anything to measure.
 *
 * The previous version offered three equally weighted buttons — inbox, add a product, create
 * an order — which is a menu, not a next step, and one of them sent a shop owner to write an
 * order by hand on the screen that exists to tell them how the business is doing.
 *
 * There is genuinely nothing to configure here: these figures accumulate on their own. So the
 * state says that plainly and offers the one place where activity actually starts.
 */
export function EmptyAnalyticsState() {
  return (
    <EmptyState
      icon={BarChart3}
      title="Nothing to measure yet"
      description="Sales, replies and AI activity are recorded automatically. As soon as customers start messaging you, this page fills in on its own — there is nothing to set up."
      action={
        <Button variant="outline" asChild>
          <Link href="/conversations">Open your inbox</Link>
        </Button>
      }
      secondaryAction={
        <>
          Not live yet?{' '}
          <Link href="/settings/whatsapp" className="font-medium text-primary hover:underline">
            Connect WhatsApp
          </Link>
        </>
      }
    />
  );
}
