'use client';

/**
 * Keeps the list honest while something is still being read.
 *
 * Processing happens in a background worker, so nothing pushes the result back to a page that
 * is already rendered. Without this, a document saved a moment ago would sit on "Processing…"
 * until the person reloaded — and the one thing they should not have to learn is that this
 * screen lies unless you refresh it.
 *
 * A poll rather than a socket. The window is seconds long, there is exactly one thing worth
 * knowing (has the status changed), and `router.refresh()` re-runs the page on the server and
 * patches the rows in place without losing scroll position or a dialog that happens to be open.
 * A live connection for a ten-second wait would be infrastructure bought for nothing.
 *
 * Renders nothing. Mounted only while `active`, which the page decides by looking at whether
 * any row is still in flight — so a settled list makes no requests at all.
 */

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { KNOWLEDGE_STATUS_POLL_MS } from '@/config/constants';

export function KnowledgeRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => {
      // A background tab has nobody watching it. Skipping the refresh there keeps a forgotten
      // window from querying the database every few seconds for the rest of the afternoon;
      // returning to the tab fires the next tick.
      if (document.visibilityState === 'hidden') return;
      router.refresh();
    }, KNOWLEDGE_STATUS_POLL_MS);

    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}
