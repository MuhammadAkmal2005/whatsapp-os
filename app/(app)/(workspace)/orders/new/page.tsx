import { ArrowLeft, ShieldX } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CreateOrderForm } from '@/components/orders/create-order-form';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getContacts } from '@/server/services/contact/contact.service';
import { orderListCapability } from '@/server/services/order/order.capability';
import { getOrderableCatalogue } from '@/server/services/order/order.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listContactsSchema } from '@/server/validation/contact';

export const metadata = { title: 'New order' };

/**
 * Create order page.
 *
 * Loads a bounded set of active products (up to 200) and recent contacts (up to 100) so
 * the picker and customer dropdown stay instant in the browser. Both have an escape hatch:
 * if the thing you need is not in the list, add it first.
 *
 * The form builds a `CreateOrderInput` and submits it to the server action, which
 * re-derives all prices and computes the real total. The figures shown in the form are
 * estimates only — the server is the source of truth.
 */
export default async function CreateOrderPage() {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const capability = orderListCapability(context);
  if (!capability.create) {
    return (
      <EmptyState
        icon={ShieldX}
        title="You cannot create orders"
        // Named in terms of what a shop owner controls — a person's role — rather than the
        // permission string behind it, which is not a thing anyone can go and change.
        description="Your role can read orders but not place them. Ask whoever owns this workspace to change your role if you need to take orders by hand."
        action={
          <Button asChild variant="outline">
            <Link href="/orders">Back to orders</Link>
          </Button>
        }
      />
    );
  }

  const [catalogue, contactsPage] = await Promise.all([
    getOrderableCatalogue(context),
    getContacts(context, listContactsSchema.parse({ limit: 100 })),
  ]);

  const customers = contactsPage.contacts.map((contact) => ({
    id: contact.id,
    name: contact.name ?? 'Unknown',
    phoneE164: contact.phoneE164,
    city: contact.city,
    addressLine1: contact.addressLine1,
    addressLine2: contact.addressLine2,
    postalCode: contact.postalCode,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New order"
        description="For an order taken over the phone, at the counter, or paid for outside a chat. Your AI writes up the ones that come in over WhatsApp itself."
        breadcrumb={
          // Pulled left by the button's own padding so the label lines up with the heading
          // below it rather than sitting a few pixels inside it.
          <Button asChild variant="ghost" size="sm" className="-ml-2.5 self-start">
            <Link href="/orders">
              <ArrowLeft aria-hidden />
              All orders
            </Link>
          </Button>
        }
      />

      <CreateOrderForm
        products={catalogue.products}
        currency={catalogue.currency}
        truncated={catalogue.truncated}
        customers={customers}
      />
    </div>
  );
}
