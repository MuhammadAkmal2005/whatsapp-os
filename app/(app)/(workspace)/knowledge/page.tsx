import { BookOpenCheck, Layers } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AddKnowledgeActions } from '@/components/knowledge/add-knowledge-actions';
import { KnowledgeEmptyState } from '@/components/knowledge/knowledge-empty-state';
import { KnowledgeRefresh } from '@/components/knowledge/knowledge-refresh';
import { KnowledgeTable } from '@/components/knowledge/knowledge-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CursorPagination } from '@/components/ui/cursor-pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { getKnowledgeDocuments } from '@/server/services/knowledge/knowledge.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { isKnowledgeInFlight, listKnowledgeDocumentsSchema } from '@/server/validation/knowledge';

export const metadata = { title: 'Knowledge' };

/** Nothing filters this list, so nothing but the cursor travels between pages. Named rather
 *  than inlined so the empty array is visibly deliberate and not an omission. */
const PRESERVED_FILTERS: readonly string[] = [];

/**
 * Everything the assistant has been taught, and the two ways to teach it more.
 *
 * The whole page is a server component apart from the dialogs and the row menu. That is what
 * lets it be re-rendered every few seconds while something is processing without the browser
 * doing any work beyond swapping the rows.
 *
 * `now` is captured once, here, and handed down. Every relative time on the page then agrees
 * about the present, and the stalled-row test compares against the same instant for all rows.
 */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const params = await searchParams;
  const parsed = listKnowledgeDocumentsSchema.safeParse({ cursor: firstParam(params.cursor) });

  // A stale link falls back to the first page rather than an error. The person wanted to see
  // their knowledge; showing the start of it beats a message about a query string.
  const input = parsed.success ? parsed.data : listKnowledgeDocumentsSchema.parse({});
  const page = await getKnowledgeDocuments(context, input);

  const now = new Date();
  const atLimit = page.usage.limit !== null && page.usage.used >= page.usage.limit;
  const anyInFlight = page.documents.some((row) => isKnowledgeInFlight(row.status));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Knowledge"
        description={`What your assistant knows about your business. ${summarise(page.usage)}`}
        actions={page.can.create && !atLimit ? <AddKnowledgeActions /> : undefined}
      />

      {atLimit ? (
        <Alert variant="warning">
          <Layers aria-hidden />
          <AlertTitle>You have reached your plan&apos;s knowledge limit</AlertTitle>
          <AlertDescription>
            Your plan includes {page.usage.limit} pieces of knowledge. Everything you have saved
            keeps working and nothing is deleted, but you cannot add more until you upgrade or
            remove something.{' '}
            <Link href="/settings/billing" className="font-medium underline underline-offset-4">
              See plans
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {page.usage.used === 0 ? (
        <KnowledgeEmptyState canCreate={page.can.create} />
      ) : page.documents.length === 0 ? (
        // A non-empty list with an empty page means a cursor from a link whose rows have since
        // moved. Nothing filters this screen, so that is the only way to get here.
        <EmptyState
          icon={BookOpenCheck}
          title="Nothing left to show"
          description="This page is past the end of your knowledge. It may have changed since this link was made."
          action={
            <Button asChild variant="outline">
              <Link href="/knowledge">Back to the start</Link>
            </Button>
          }
        />
      ) : (
        // `overflow-hidden` so the heading row's sunken fill is clipped by the card's corners
        // instead of squaring them off.
        <Card className="overflow-hidden">
          <KnowledgeTable documents={page.documents} now={now} />
          <CursorPagination
            basePath="/knowledge"
            params={params}
            preserve={PRESERVED_FILTERS}
            cursor={page.nextCursor}
            isPastFirstPage={Boolean(input.cursor)}
            itemsLabel="knowledge"
          />
        </Card>
      )}

      <KnowledgeRefresh active={anyInFlight} />
    </div>
  );
}

function summarise(usage: { used: number; limit: number | null }): string {
  // The noun agrees with the number it stands next to. "1 piece saved", but "1 of 150 pieces on
  // your plan" — in the second sentence the noun belongs to the allowance, not to the count.
  if (usage.limit === null) {
    return `${usage.used} ${usage.used === 1 ? 'piece' : 'pieces'} saved.`;
  }
  return `${usage.used} of ${usage.limit} ${usage.limit === 1 ? 'piece' : 'pieces'} on your plan.`;
}
