import Link from 'next/link';

import { ContactStatusBadge, LeadStageBadge, displayName, initials } from '@/components/contacts/contact-badges';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/datetime';
import { formatMoney, money } from '@/lib/money';
import type { SupportedCurrency } from '@/config/constants';
import type { Contact } from '@/server/services/contact/contact.service';

/**
 * The customer list.
 *
 * A list of rows rather than a table, and that is not laziness: the same markup has
 * to work on a phone, where a five-column table either scrolls sideways or shrinks
 * the text past reading. Each row is one link with everything a shop owner scans for
 * — who, where, what they are worth, when they last spoke — and the secondary detail
 * folds under the name instead of into columns that fall off the screen.
 *
 * A server component: no interactivity, so none of this reaches the browser as JS.
 */
export function ContactList({
  contacts,
  currency,
}: {
  contacts: Contact[];
  currency: SupportedCurrency;
}) {
  return (
    <ul className="divide-y divide-border">
      {contacts.map((contact) => (
        <ContactRow key={contact.id} contact={contact} currency={currency} />
      ))}
    </ul>
  );
}

function ContactRow({ contact, currency }: { contact: Contact; currency: SupportedCurrency }) {
  const name = displayName(contact);
  const spent = formatMoney(money(contact.totalSpentMinor, currency));

  return (
    <li>
      <Link
        href={`/contacts/${contact.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-6"
      >
        <Avatar className="shrink-0">
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">{name}</span>
            <ContactStatusBadge status={contact.status} />
            {contact.optedOutAt ? <Badge variant="muted">Opted out</Badge> : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {/* The number is shown in full: it is the business's own customer record,
                and it is what they dial. Masking is for logs, not for this page. */}
            {contact.phoneE164}
            {contact.city ? ` · ${contact.city}` : ''}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 text-end">
          <span className="text-sm font-medium text-foreground">
            {contact.totalOrders > 0
              ? `${contact.totalOrders} ${contact.totalOrders === 1 ? 'order' : 'orders'} · ${spent}`
              : 'No orders yet'}
          </span>
          <span className="text-xs text-muted-foreground">
            {contact.lastInteractionAt
              ? `Last spoke ${formatRelativeTime(contact.lastInteractionAt)}`
              : 'Not messaged yet'}
          </span>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
          <LeadStageBadge stage={contact.leadStage} />
          <span className="truncate text-xs text-muted-foreground">
            {contact.assignedToName ?? 'Unassigned'}
          </span>
        </div>
      </Link>
    </li>
  );
}
