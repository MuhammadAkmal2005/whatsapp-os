import Link from 'next/link';

import {
  ContactStatusBadge,
  LeadStageBadge,
  displayName,
} from '@/components/contacts/contact-badges';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatRelativeTimeCompact } from '@/lib/datetime';
import { initials } from '@/lib/names';
import { formatMoney, money } from '@/lib/money';
import type { SupportedCurrency } from '@/config/constants';
import type { Contact } from '@/server/services/contact/contact.service';

/**
 * The customer list.
 *
 * A table, for the reason given in `product-list.tsx`. A CRM list in particular is read down
 * its columns: who has spent the most, who has gone quiet, which stage the pipeline is
 * clogged at. Stacked rows made every one of those questions a reading task.
 *
 * Below `md` two columns are drawn — who they are and what they have spent — with the number,
 * order count, last contact and pipeline stage folded into the first cell. From `md` up each
 * gets its own column and the folded line drops away, so no fact is drawn twice and nothing
 * visible on a phone disappears on a laptop. Status sits beside the name at every width
 * rather than taking a column: it is part of who this customer is, not a field to compare.
 *
 * A server component: nothing here is interactive, so none of it ships as JavaScript.
 */
export function ContactList({
  contacts,
  currency,
  now,
}: {
  contacts: Contact[];
  currency: SupportedCurrency;
  /** Resolved once by the page so every row measures "3h" against the same instant. */
  now: Date;
}) {
  return (
    <TableContainer>
      <Table aria-label="Customers">
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead className="hidden md:table-cell">Phone</TableHead>
            <TableHead className="hidden md:table-cell">Stage</TableHead>
            <TableHead className="hidden md:table-cell" numeric>
              Orders
            </TableHead>
            <TableHead numeric>Spent</TableHead>
            <TableHead className="hidden md:table-cell">Last spoke</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => (
            <ContactRow key={contact.id} contact={contact} currency={currency} now={now} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ContactRow({
  contact,
  currency,
  now,
}: {
  contact: Contact;
  currency: SupportedCurrency;
  now: Date;
}) {
  const name = displayName(contact);
  const lastSpoke = contact.lastInteractionAt
    ? formatRelativeTimeCompact(contact.lastInteractionAt, now)
    : null;
  const orders = `${contact.totalOrders} ${contact.totalOrders === 1 ? 'order' : 'orders'}`;

  return (
    // `relative` so the name's stretched overlay covers this row and nothing wider.
    <TableRow interactive className="relative">
      <TableCell>
        <span className="flex items-center gap-2.5">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>

          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={`/contacts/${contact.id}`}
                className="font-medium text-foreground after:absolute after:inset-0 after:content-['']"
              >
                {name}
              </Link>
              <ContactStatusBadge status={contact.status} />
              {/* Opting out changes what the business is allowed to send, so it is stated
                  on the row rather than left for the profile page to reveal. */}
              {contact.optedOutAt ? <Badge variant="muted">Opted out</Badge> : null}
            </span>

            <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">
              {/* The number is shown in full: it is the business's own customer record, and
                  it is what they dial. Masking is for logs, not for this page. */}
              {contact.phoneE164} · {orders}
              {lastSpoke ? ` · ${lastSpoke}` : ''}
            </span>

            <span className="mt-1.5 flex md:hidden">
              <LeadStageBadge stage={contact.leadStage} />
            </span>

            {contact.assignedToName ? (
              <span className="mt-0.5 hidden text-xs text-muted-foreground md:block">
                {contact.assignedToName}
              </span>
            ) : null}
          </span>
        </span>
      </TableCell>

      <TableCell className="hidden whitespace-nowrap font-mono text-xs text-muted-foreground md:table-cell">
        {contact.phoneE164}
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <LeadStageBadge stage={contact.leadStage} />
      </TableCell>

      <TableCell className="hidden text-muted-foreground md:table-cell" numeric>
        {contact.totalOrders}
      </TableCell>

      <TableCell numeric>
        {contact.totalOrders > 0 ? (
          <span className="font-medium text-foreground">
            {formatMoney(money(contact.totalSpentMinor, currency))}
          </span>
        ) : (
          // An em dash, not "Rs 0". A customer who has never ordered has no spend to
          // report, and a zero in a money column reads as a figure that was measured.
          // The dash is decoration to a screen reader, so the meaning is spelled out.
          <span className="text-muted-foreground">
            <span aria-hidden>—</span>
            <span className="sr-only">No orders yet</span>
          </span>
        )}
      </TableCell>

      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
        {lastSpoke ?? 'Not yet'}
      </TableCell>
    </TableRow>
  );
}
