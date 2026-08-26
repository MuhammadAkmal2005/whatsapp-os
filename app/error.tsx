'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Root error boundary. Next.js renders this when a page or Server Component in
 * the tree throws. The raw message never reaches the screen — it can carry
 * internal detail — only a calm explanation, a retry that re-renders the failed
 * segment, and the `digest` Next.js attaches to a server error, shown as a
 * reference so a support request can be tied back to the server log without
 * exposing the stack.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Kept out of the UI on purpose; logged so it is visible in the console
    // during development and to any error reporter wired in later. Server-side,
    // the same throw is already logged alongside its digest.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
      >
        <TriangleAlert className="size-7" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          An unexpected error stopped this page from loading. Please try again — if it keeps
          happening, get in touch with our team.
        </p>
        {error.digest ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Reference:{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs">{error.digest}</code>
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Go to homepage</Link>
        </Button>
      </div>
    </main>
  );
}
