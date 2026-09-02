import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getUserContext } from '@/server/tenancy/resolve';

export const metadata = { title: 'Page not found' };

/**
 * Root 404. Rendered inside the root layout with no app chrome, so it stands on
 * its own. It sends a signed-in person back to their dashboard and everyone else
 * to the homepage — both are always-valid destinations, so the escape hatch is
 * never itself another dead end.
 */
export default async function NotFound() {
  const context = await getUserContext();
  const href = context ? '/dashboard' : '/';
  const label = context ? 'Back to dashboard' : 'Back to home';

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"
      >
        <Compass className="size-7" />
      </span>
      <div className="flex flex-col gap-2">
        <p className="eyebrow">Error 404</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          We couldn&apos;t find that page
        </h1>
        <p className="mx-auto max-w-form text-sm text-muted-foreground">
          The page you&apos;re looking for may have been moved or no longer exists. Check the
          address, or head back to somewhere familiar.
        </p>
      </div>
      <Button asChild>
        <Link href={href}>
          <ArrowLeft aria-hidden />
          {label}
        </Link>
      </Button>
    </main>
  );
}
