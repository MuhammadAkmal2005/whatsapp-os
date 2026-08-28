import { redirect } from 'next/navigation';

import { CreateOrderForm } from '@/components/orders/create-order-form';
import { EmptyState } from '@/components/ui/empty-state';
import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { orderListCapability } from '@/server/services/order/order.capability';
import { getOrderableCatalogue } from '@/server/services/order/order.service';
import { getContacts } from '@/server/services/contact/contact.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listContactsSchema } from '@/server/validation/contact';

export const metadata = { title: 'Create Order' };

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
        description="Your role does not have permission to create orders. Ask your workspace owner to grant you the order:create permission."
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create order</h1>
        <p className="text-sm text-muted-foreground">
          Place an order on behalf of a customer.
        </p>
      </div>

      <CreateOrderForm
        products={catalogue.products}
        currency={catalogue.currency}
        truncated={catalogue.truncated}
        customers={customers}
      />
    </div>
  );
}
