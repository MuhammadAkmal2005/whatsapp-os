import { ArrowLeft, BellOff } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import {
  ContactStatusBadge,
  LeadStageBadge,
  displayName,
} from '@/components/contacts/contact-badges';
import { ContactNotes } from '@/components/contacts/contact-notes';
import { ContactQuickControls } from '@/components/contacts/contact-quick-controls';
import { DeleteContactDialog } from '@/components/contacts/delete-contact-dialog';
import { EditContactForm } from '@/components/contacts/edit-contact-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatBand } from '@/components/ui/stat';
import type { SupportedCurrency } from '@/config/constants';
import { formatDate, formatRelativeTime } from '@/lib/datetime';
import { initials } from '@/lib/names';
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
  // One clock for the whole page, so "Last order" and "Last spoke" are measured against the
  // same instant rather than each reading its own slightly later one.
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={name}
        description={
          <>
            {contact.phoneE164}
            {contact.city ? ` · ${contact.city}` : ''}
            {contact.source ? ` · from ${contact.source}` : ''}
          </>
        }
        leading={
          <Avatar className="size-11 shrink-0">
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
        }
        badges={
          <>
            <ContactStatusBadge status={contact.status} />
            <LeadStageBadge stage={contact.leadStage} />
            {contact.optedOutAt ? <Badge variant="muted">Opted out</Badge> : null}
          </>
        }
        breadcrumb={
          // Pulled left by the button's own padding so the label lines up with the title
          // below it rather than sitting a few pixels inside it.
          <Button asChild variant="ghost" size="sm" className="-ml-2.5 self-start">
            <Link href="/contacts">
              <ArrowLeft aria-hidden />
              All customers
            </Link>
          </Button>
        }
        actions={
          detail.can.delete ? (
            <DeleteContactDialog contactId={contact.id} contactName={name} />
          ) : undefined
        }
      />

      {contact.optedOutAt ? (
        // Not a warning surface: nothing has gone wrong, and the customer's own choice is
        // not an error state. It is a rule the team needs to know before they reply.
        <Alert>
          <BellOff aria-hidden />
          <AlertTitle>This customer asked to stop receiving messages</AlertTitle>
          <AlertDescription>
            They opted out on {formatDate(contact.optedOutAt)}. Your AI will not message them
            first, and neither should you — only reply if they message you.
          </AlertDescription>
        </Alert>
      ) : null}

      <Summary contact={contact} currency={context.currency} now={now} />

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
        <CardContent className="pt-5">
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
 * The four figures worth knowing before you reply.
 *
 * `totalOrders` and `totalSpentMinor` are stored on the contact rather than summed
 * here: they are read on every list row and every profile, and a sum over the order
 * table per customer is the query that gets slow first.
 */
function Summary({
  contact,
  currency,
  now,
}: {
  contact: ContactDetail['contact'];
  currency: SupportedCurrency;
  now: Date;
}) {
  return (
    <StatBand label="Customer at a glance" columns={4}>
      <Stat
        label="Orders"
        value={contact.totalOrders === 0 ? 'None yet' : String(contact.totalOrders)}
      />
      <Stat label="Total spent" value={formatMoney(money(contact.totalSpentMinor, currency))} />
      <Stat
        label="Last order"
        value={contact.lastOrderAt ? formatRelativeTime(contact.lastOrderAt, now) : 'Never ordered'}
      />
      <Stat
        label="Last spoke"
        value={
          contact.lastInteractionAt
            ? formatRelativeTime(contact.lastInteractionAt, now)
            : 'Not messaged yet'
        }
      />
    </StatBand>
  );
}
