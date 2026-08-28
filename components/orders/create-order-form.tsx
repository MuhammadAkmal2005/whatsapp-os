'use client';

/**
 * The create order form.
 *
 * A shop owner places an order on behalf of a customer — someone rang, someone messaged
 * on WhatsApp and paid over the counter, or they are entering a backlog. The form asks
 * for everything `createOrderSchema` requires: a contact, items with quantities, delivery
 * details, and payment method.
 *
 * The product picker loads a bounded set of active products (up to 200) so search stays
 * instant in the browser. The contact picker loads up to 100 recent contacts for the same
 * reason. Both have a fallback: "Can't find it? Add it first."
 *
 * Prices shown are estimates. `createOrder` re-reads every price from the database when
 * the order is placed, so the charged figure never comes from the client.
 *
 * The form supports optional discount/delivery/tax overrides typed in major units. These
 * are parsed with `parseMoney` (client-safe) and sent as minor units. The server ignores
 * them for AI-created orders; only human-placed orders honor them, so a shop owner can
 * give a deal or charge for express shipping.
 */

import { PackageX, Trash2, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createOrder } from '@/app/(app)/(workspace)/orders/actions';
import { OrderProductPicker } from '@/components/orders/order-product-picker';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import type { SupportedCurrency } from '@/config/constants';
import { formatMoney, money, parseMoney } from '@/lib/money';
import type { OrderableOption, OrderableProduct } from '@/server/services/order/order.service';
import {
  ORDER_FIELD_MAX,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type CreateOrderInput,
} from '@/server/validation/order';

type CustomerOption = {
  id: string;
  name: string;
  phoneE164: string;
  city: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
};

type SelectedItem = {
  option: OrderableOption;
  quantity: number;
};

export function CreateOrderForm({
  products,
  currency,
  truncated,
  customers,
}: {
  products: OrderableProduct[];
  currency: SupportedCurrency;
  truncated: boolean;
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Contact
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [phoneE164, setPhoneE164] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // Items
  const [items, setItems] = useState<SelectedItem[]>([]);

  // Payment & notes
  const [paymentMethod, setPaymentMethod] = useState<CreateOrderInput['paymentMethod']>('COD');
  const [notes, setNotes] = useState('');

  // Optional overrides (typed in major units, parsed to minor)
  const [discountMajor, setDiscountMajor] = useState('');
  const [deliveryFeeMajor, setDeliveryFeeMajor] = useState('');
  const [taxMajor, setTaxMajor] = useState('');

  // When a customer is picked, fill the address fields
  function selectCustomer(customerId: string) {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;

    setSelectedContactId(customer.id);
    setCustomerName(customer.name);
    setPhoneE164(customer.phoneE164);
    setAddressLine1(customer.addressLine1 ?? '');
    setAddressLine2(customer.addressLine2 ?? '');
    setCity(customer.city ?? '');
    setPostalCode(customer.postalCode ?? '');
  }

  function addItem(option: OrderableOption) {
    const existing = items.find((item) => item.option.key === option.key);
    if (existing) {
      setItems(
        items.map((item) =>
          item.option.key === option.key ? { ...item, quantity: item.quantity + 1 } : item,
        ),
      );
    } else {
      setItems([...items, { option, quantity: 1 }]);
    }
  }

  function updateQuantity(key: string, quantity: number) {
    if (quantity <= 0) {
      setItems(items.filter((item) => item.option.key !== key));
    } else {
      setItems(
        items.map((item) => (item.option.key === key ? { ...item, quantity } : item)),
      );
    }
  }

  function removeItem(key: string) {
    setItems(items.filter((item) => item.option.key !== key));
  }

  // Client-side estimate only — the server recalculates everything from database prices
  const subtotalMinor = items.reduce(
    (sum, item) => sum + item.option.unitPriceMinor * item.quantity,
    0,
  );
  const discountMinor = parseMoney(discountMajor.trim(), currency)?.minor ?? 0;
  const deliveryMinor = parseMoney(deliveryFeeMajor.trim(), currency)?.minor ?? 0;
  const taxMinor = parseMoney(taxMajor.trim(), currency)?.minor ?? 0;
  const estimatedTotalMinor = Math.max(0, subtotalMinor - discountMinor + deliveryMinor + taxMinor);

  const selectedMap = items.reduce(
    (acc, item) => {
      acc[item.option.key] = item.quantity;
      return acc;
    },
    {} as Record<string, number>,
  );

  const canSubmit =
    !pending &&
    selectedContactId &&
    customerName.trim().length > 0 &&
    phoneE164.trim().length > 0 &&
    items.length > 0;

  function submit() {
    if (!canSubmit || !selectedContactId) return;

    const input: CreateOrderInput = {
      contactId: selectedContactId,
      items: items.map((item) => ({
        productId: item.option.productId,
        variantId: item.option.variantId,
        quantity: item.quantity,
      })),
      customerName: customerName.trim(),
      phoneE164: phoneE164.trim(),
      addressLine1: addressLine1.trim() || null,
      addressLine2: addressLine2.trim() || null,
      city: city.trim() || null,
      postalCode: postalCode.trim() || null,
      country: 'PK',
      paymentMethod,
      notes: notes.trim() || null,
      discountMinor: discountMinor > 0 ? discountMinor : undefined,
      deliveryFeeMinor: deliveryMinor > 0 ? deliveryMinor : undefined,
      taxMinor: taxMinor > 0 ? taxMinor : undefined,
    };

    setError(null);
    startTransition(async () => {
      const result = await createOrder(input);
      if (result.ok) {
        router.push(`/orders/${result.data.orderId}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: items + totals */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
                  <PackageX className="size-5 text-muted-foreground" aria-hidden />
                  <p className="text-sm text-muted-foreground">
                    No items yet. Add products from the picker below.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {items.map((item) => (
                    <li
                      key={item.option.key}
                      className="flex items-start justify-between gap-4 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{item.option.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(money(item.option.unitPriceMinor, currency))} each
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={item.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) updateQuantity(item.option.key, val);
                          }}
                          className="w-16 text-center"
                          min="1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(item.option.key)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Remove</span>
                        </Button>
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {formatMoney(money(item.option.unitPriceMinor * item.quantity, currency))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-t border-border pt-4">
                <OrderProductPicker
                  products={products}
                  currency={currency}
                  truncated={truncated}
                  selected={selectedMap}
                  onAdd={addItem}
                />
              </div>
            </CardContent>
          </Card>

          {items.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Order total</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="font-medium">{formatMoney(money(subtotalMinor, currency))}</dd>
                  </div>

                  <FormField>
                    <div className="flex items-center justify-between gap-4">
                      <FormLabel className="text-muted-foreground">Discount</FormLabel>
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={discountMajor}
                          onChange={(e) => setDiscountMajor(e.target.value)}
                          placeholder="0"
                          className="w-24 text-end"
                        />
                      </div>
                    </div>
                    <FormDescription className="text-xs">
                      Optional. Leave empty for no discount.
                    </FormDescription>
                  </FormField>

                  {discountMinor > 0 ? (
                    <div className="flex items-center justify-between text-destructive">
                      <dt>Discount</dt>
                      <dd className="font-medium">
                        − {formatMoney(money(discountMinor, currency))}
                      </dd>
                    </div>
                  ) : null}

                  <FormField>
                    <div className="flex items-center justify-between gap-4">
                      <FormLabel className="text-muted-foreground">Delivery fee</FormLabel>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={deliveryFeeMajor}
                        onChange={(e) => setDeliveryFeeMajor(e.target.value)}
                        placeholder="0"
                        className="w-24 text-end"
                      />
                    </div>
                    <FormDescription className="text-xs">
                      Optional. Leave empty for free delivery.
                    </FormDescription>
                  </FormField>

                  {deliveryMinor > 0 ? (
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Delivery</dt>
                      <dd className="font-medium">{formatMoney(money(deliveryMinor, currency))}</dd>
                    </div>
                  ) : null}

                  <FormField>
                    <div className="flex items-center justify-between gap-4">
                      <FormLabel className="text-muted-foreground">Tax</FormLabel>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={taxMajor}
                        onChange={(e) => setTaxMajor(e.target.value)}
                        placeholder="0"
                        className="w-24 text-end"
                      />
                    </div>
                    <FormDescription className="text-xs">
                      Optional. Leave empty for no tax.
                    </FormDescription>
                  </FormField>

                  {taxMinor > 0 ? (
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Tax</dt>
                      <dd className="font-medium">{formatMoney(money(taxMinor, currency))}</dd>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
                    <dt>Estimated total</dt>
                    <dd>{formatMoney(money(estimatedTotalMinor, currency))}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  Final total is confirmed when the order is placed, using current prices from your
                  catalogue.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Right column: customer + delivery + payment */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {customers.length === 0 ? (
                <EmptyState
                  icon={User}
                  title="No customers yet"
                  description="Add a customer to your contacts first, then come back to create an order."
                  action={
                    <Button asChild variant="outline" size="sm">
                      <Link href="/contacts">Go to customers</Link>
                    </Button>
                  }
                />
              ) : (
                <>
                  <FormField>
                    <FormLabel>Select customer</FormLabel>
                    <FormControl>
                      <Select
                        value={selectedContactId ?? undefined}
                        onValueChange={selectCustomer}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a customer" />
                        </SelectTrigger>
                        <SelectContent>
                          {customers.map((customer) => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      Showing your {customers.length} most recent customers.{' '}
                      <Link href="/contacts" className="underline">
                        Can&apos;t find them?
                      </Link>
                    </FormDescription>
                  </FormField>

                  <FormField>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Customer name"
                        maxLength={ORDER_FIELD_MAX.customerName}
                        autoComplete="name"
                      />
                    </FormControl>
                  </FormField>

                  <FormField>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        value={phoneE164}
                        onChange={(e) => setPhoneE164(e.target.value)}
                        placeholder="+923001234567"
                        autoComplete="tel"
                      />
                    </FormControl>
                  </FormField>
                </>
              )}
            </CardContent>
          </Card>

          {selectedContactId ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Delivery address</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <FormField>
                    <FormLabel>Address line 1</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                        placeholder="House number, street"
                        maxLength={ORDER_FIELD_MAX.addressLine}
                        autoComplete="address-line1"
                      />
                    </FormControl>
                  </FormField>

                  <FormField>
                    <FormLabel>Address line 2</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        value={addressLine2}
                        onChange={(e) => setAddressLine2(e.target.value)}
                        placeholder="Area, landmark (optional)"
                        maxLength={ORDER_FIELD_MAX.addressLine}
                        autoComplete="address-line2"
                      />
                    </FormControl>
                  </FormField>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="City"
                          maxLength={ORDER_FIELD_MAX.city}
                          autoComplete="address-level2"
                        />
                      </FormControl>
                    </FormField>

                    <FormField>
                      <FormLabel>Postal code</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          value={postalCode}
                          onChange={(e) => setPostalCode(e.target.value)}
                          placeholder="Code"
                          maxLength={ORDER_FIELD_MAX.postalCode}
                          autoComplete="postal-code"
                        />
                      </FormControl>
                    </FormField>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment & notes</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <FormField>
                    <FormLabel>Payment method</FormLabel>
                    <FormControl>
                      <Select
                        value={paymentMethod}
                        onValueChange={(value) =>
                          setPaymentMethod(value as CreateOrderInput['paymentMethod'])
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((method) => (
                            <SelectItem key={method} value={method}>
                              {PAYMENT_METHOD_LABELS[method]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormField>

                  <FormField>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Optional notes for this order"
                        rows={3}
                        maxLength={ORDER_FIELD_MAX.notes}
                      />
                    </FormControl>
                  </FormField>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
        <Button asChild variant="ghost">
          <Link href="/orders">Cancel</Link>
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={submit}>
          {pending ? <Spinner className="size-4" /> : null}
          Place order
        </Button>
      </div>
    </div>
  );
}
