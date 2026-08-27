import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import {
  ContactStatusBadge,
  LeadStageBadge,
  displayName,
  initials,
} from '@/components/contacts/contact-badges';
import { ContactNotes } from '@/components/contacts/contact-notes';
import { ContactQuickControls } from '@/components/contacts/contact-quick-controls';
import { DeleteContactDialog } from '@/components/contacts/delete-contact-dialog';
import { EditContactForm } from '@/components/contacts/edit-contact-form';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { SupportedCurrency } from '@/config/constants';
import { formatDate, formatRelativeTime } from '@/lib/datetime';
import { formatMoney, money } from '@/lib/money';
import { NotFoundError } from '@/server/errors';
import { getContact, type ContactDetail } from '@/server/services/contact/contact.service';
import type { TenantContext } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';
import { contactId as contactIdSchema } from '@/server/validation/contact';

type RouteParams = Promise<{ id: string }>;

/**
 * Loaded once per request, not twice.
 *
 * Next runs `generateMetadata` and the page component in the same request, and both
 * need the customer. Prisma queries are not deduplicated the way `fetch` is, so
 * without `cache` every profile view would run the contact, notes and members queries
 * twice over. `cache` keys on the arguments, and both callers pass the same id.
 */
const loadContact = cache(async (context: TenantContext, id: string) =>
  getContact(context, id),
);

/**
 * One customer.
 *
 * Everything a shop owner needs before replying to a message: who they are, what they
 * have bought, what stage they are at, and what a colleague wrote about them last time.
 *
 * There are three separate save paths on this page and that is deliberate. The status,
 * stage and assignment pickers save the moment they change, because those are one-tap
 * decisions made while reading. The details form saves on submit, because an address is
 * typed and a half-typed address must not be stored. Removal asks for the name. Mixing
 * them into one form would mean either an address that saves per keystroke or a stage
 * change that needs a button — and it would also mean a save here clearing the
 * assignment, which is the bug documented on `updateContactSchema`.
 */
export async function generateMetadata({ params }: { params: RouteParams }) {
  const context = await getTenantContext();
  if (!context) return { title: 'Customer' };

  const parsed = contactIdSchema.safeParse((await params).id);
  if (!parsed.success) return { title: 'Customer not found' };

  // A failed load here must not take down the page — the title is cosmetic and the
  // component below renders the real 404. Next calls this alongside the page, so a
  // throw would surface as an error boundary instead of a not-found.
  try {
    const detail = await loadContact(context, parsed.data);
    return { title: displayName(detail.contact) };
  } catch {
    return { title: 'Customer not found' };
  }
}

export default async function ContactDetailPage({ params }: { params: RouteParams }) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  // A malformed id is a 404, not a 500. Without this the string reaches Prisma, which
  // rejects it as an invalid uuid and turns a mistyped URL into an error page.
  const parsed = contactIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  let detail: ContactDetail;
  try {
    detail = await loadContact(context, parsed.data);
  } catch (error) {
    // The service throws NotFoundError for a customer in another workspace as well as
    // for one that does not exist, and the two are meant to be indistinguishable.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { contact } = detail;
  const name = displayName(contact);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/contacts">
            <ArrowLeft className="size-4" aria-hidden />
            All customers
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="size-12 shrink-0">
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                {name}
              </h1>
              <ContactStatusBadge status={contact.status} />
              <LeadStageBadge stage={contact.leadStage} />
              {contact.optedOutAt ? <Badge variant="muted">Opted out</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {contact.phoneE164}
              {contact.city ? ` · ${contact.city}` : ''}
              {contact.source ? ` · from ${contact.source}` : ''}
            </p>
          </div>
        </div>

        {detail.can.delete ? (
          <DeleteContactDialog contactId={contact.id} contactName={name} />
        ) : null}
      </div>

      {contact.optedOutAt ? (
        <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This customer asked to stop receiving messages on{' '}
          {formatDate(contact.optedOutAt)}. Your AI and your campaigns will not message
          them, and you should only reply if they message you first.
        </p>
      ) : null}

      <Summary contact={contact} currency={context.currency} />

      <Card>
        <CardHeader>
          <CardTitle>Status and ownership</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Saves on change. See the note at the top of the file for why this is not
              part of the details form below. */}
          <ContactQuickControls
            contactId={contact.id}
            status={contact.status}
            leadStage={contact.leadStage}
            assignedToMemberId={contact.assignedToMemberId}
            assignees={detail.assignees}
            canUpdate={detail.can.update}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <EditContactForm contact={contact} canUpdate={detail.can.update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
          <CardDescription>
            Only your team can see these. The customer never does.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContactNotes
            contactId={contact.id}
            notes={detail.notes}
            canAddNote={detail.can.addNote}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The four numbers worth knowing before you reply.
 *
 * `totalOrders` and `totalSpentMinor` are stored on the contact rather than summed
 * here: they are read on every list row and every profile, and a sum over the order
 * table per customer is the query that gets slow first.
 */
function Summary({
  contact,
  currency,
}: {
  contact: ContactDetail['contact'];
  currency: SupportedCurrency;
}) {
  const items = [
    {
      label: 'Orders',
      value: contact.totalOrders === 0 ? 'None yet' : String(contact.totalOrders),
    },
    {
      label: 'Total spent',
      value: formatMoney(money(contact.totalSpentMinor, currency)),
    },
    {
      label: 'Last order',
      value: contact.lastOrderAt ? formatRelativeTime(contact.lastOrderAt) : 'Never ordered',
    },
    {
      label: 'Last spoke',
      value: contact.lastInteractionAt
        ? formatRelativeTime(contact.lastInteractionAt)
        : 'Not messaged yet',
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 truncate text-lg font-semibold text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
