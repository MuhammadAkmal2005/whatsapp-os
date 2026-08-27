import { Users, UserX } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ContactFilters } from '@/components/contacts/contact-filters';
import { ContactList } from '@/components/contacts/contact-list';
import { CreateContactDialog } from '@/components/contacts/create-contact-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { firstParam } from '@/lib/search-params';
import { getContacts } from '@/server/services/contact/contact.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listContactsSchema } from '@/server/validation/contact';

export const metadata = { title: 'Customers' };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The customer list.
 *
 * Filters come from the URL and are validated with the same schema the actions use,
 * so a hand-edited query string cannot reach the repository with a status that is not
 * a status. `limit` is deliberately *not* read from the URL: it decides how much work
 * Postgres does per request, and it is not a knob a visitor should be able to turn.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const params = await searchParams;
  const parsed = listContactsSchema.safeParse({
    search: firstParam(params.search),
    status: firstParam(params.status),
    leadStage: firstParam(params.leadStage),
    assignedTo: firstParam(params.assignedTo),
    cursor: firstParam(params.cursor),
  });

  // A stale or hand-edited link falls back to the unfiltered list rather than an
  // error page. The person wanted to see their customers; showing them all of them
  // is a better answer than a validation message about a query string they did not
  // type.
  const input = parsed.success ? parsed.data : listContactsSchema.parse({});
  const page = await getContacts(context, input);

  const isFiltered = Boolean(input.search || input.status || input.leadStage || input.assignedTo);
  const atLimit = page.usage.limit !== null && page.usage.used >= page.usage.limit;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone who has messaged you, and everyone you have added. {summarise(page.usage)}
          </p>
        </div>
        {page.can.create && !atLimit ? <CreateContactDialog assignees={page.assignees} /> : null}
      </div>

      {atLimit ? (
        <Alert variant="warning">
          <Users className="size-4" aria-hidden />
          <AlertTitle>You have reached your plan&apos;s customer limit</AlertTitle>
          <AlertDescription>
            Your plan includes {page.usage.limit} customers. Existing customers keep working and
            nothing is deleted, but new ones cannot be added until you upgrade.{' '}
            <Link href="/settings/billing" className="font-medium underline underline-offset-4">
              See plans
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {page.usage.used > 0 ? <ContactFilters assignees={page.assignees} /> : null}

      {page.usage.used === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers yet"
          description="When someone messages your WhatsApp number, their record appears here automatically — with their orders, notes and full conversation history."
          action={page.can.create ? <CreateContactDialog assignees={page.assignees} /> : undefined}
          secondaryAction="You can also add a walk-in or phone-order customer by hand."
        />
      ) : page.contacts.length === 0 ? (
        // Two ways to reach an empty page with a non-empty workspace: filters that
        // match nothing, or a cursor from a link whose rows have since moved. Both
        // recover with the same click, but saying which one happened is the
        // difference between a dead end and an explanation.
        <EmptyState
          icon={UserX}
          title={isFiltered ? 'No customers match these filters' : 'Nothing left to show'}
          description={
            isFiltered
              ? 'Try a different status or stage, or clear the search to see everyone again.'
              : 'This page is past the end of your customer list. It may have changed since this link was made.'
          }
          action={
            <Button asChild variant="outline">
              <Link href="/contacts">{isFiltered ? 'Clear filters' : 'Back to the start'}</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ContactList contacts={page.contacts} currency={context.currency} />
          </CardContent>
        </Card>
      )}

      {page.nextCursor || input.cursor ? (
        <Pagination cursor={page.nextCursor} params={params} showFirst={Boolean(input.cursor)} />
      ) : null}
    </div>
  );
}

function summarise(usage: { used: number; limit: number | null }): string {
  const noun = usage.used === 1 ? 'customer' : 'customers';
  if (usage.limit === null) return `${usage.used} ${noun}.`;
  return `${usage.used} of ${usage.limit} ${noun} on your plan.`;
}

/**
 * Cursor pagination, so a list that changes while it is being read never shows the
 * same customer on two pages. There is no "previous": the browser's back button is
 * the previous page, and it is the control people already reach for.
 */
function Pagination({
  cursor,
  params,
  showFirst,
}: {
  cursor: string | null;
  params: SearchParams;
  showFirst: boolean;
}) {
  const preserved = new URLSearchParams();
  for (const key of ['search', 'status', 'leadStage', 'assignedTo']) {
    const value = firstParam(params[key]);
    if (value) preserved.set(key, value);
  }

  const firstHref = preserved.toString() ? `/contacts?${preserved.toString()}` : '/contacts';
  const nextParams = new URLSearchParams(preserved.toString());
  if (cursor) nextParams.set('cursor', cursor);

  return (
    <div className="flex items-center justify-between gap-3">
      {showFirst ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={firstHref}>Back to the start</Link>
        </Button>
      ) : (
        <span />
      )}
      {cursor ? (
        <Button asChild variant="outline" size="sm">
          <Link href={`/contacts?${nextParams.toString()}`}>Show more customers</Link>
        </Button>
      ) : null}
    </div>
  );
}
