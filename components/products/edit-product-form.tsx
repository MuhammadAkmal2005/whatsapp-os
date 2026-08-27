'use client';

/**
 * Edit a product's details.
 *
 * Not a modal, for the same reason the create form is a page: ten fields behind a dialog
 * puts the keyboard over half of them on a phone. The fields read as a record until "Edit"
 * is pressed, then become a form — so a product page is something you *look at* by default,
 * not something with unsaved changes waiting in it.
 *
 * This is a **write-through** save: `updateProductSchema` has no defaults and every field
 * is sent, so a column the form omitted would be written as cleared. That is why the whole
 * of `ProductCoreFields` is submitted — name through status — and why the price fields are
 * seeded from the stored amounts rather than left blank. A blank price on an edit form is
 * not "unchanged", it is "set the price to nothing", and the schema would rightly refuse it.
 */

import { useActionState, useEffect, useState } from 'react';

import {
  ProductCoreFields,
  type Category,
  type ProductFieldDefaults,
} from '@/components/products/product-core-fields';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { coerceCurrency, money, toMajor } from '@/lib/money';
import { updateProductAction } from '@/server/actions/product.actions';
import type { ProductDetail } from '@/server/services/product/product.service';

export function EditProductForm({
  product,
  categories,
  canUpdate,
}: {
  product: ProductDetail;
  categories: Category[];
  canUpdate: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(updateProductAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  // Tracking is controlled here so it survives a Cancel: a native form reset restores the
  // text inputs, but not React state, so the switch has to be put back by hand.
  const [tracking, setTracking] = useState(product.trackInventory);

  useEffect(() => {
    if (state.status === 'success') setEditing(false);
  }, [state]);

  // The stored amount is what the person typed, shown back the way they typed it: `3499`,
  // not `349900`. The currency is the product's own, so a value entered in dirhams is not
  // relabelled with a rupee symbol.
  const currency = coerceCurrency(product.currency);
  const toDisplay = (minor: number | null) =>
    minor === null ? '' : String(toMajor(money(minor, currency)));

  const defaults: ProductFieldDefaults = {
    name: product.name,
    description: product.description ?? '',
    sku: product.sku ?? '',
    categoryId: product.categoryId ?? '',
    price: toDisplay(product.priceMinor),
    salePrice: toDisplay(product.salePriceMinor),
    weight: product.weightGrams === null ? '' : String(product.weightGrams),
    status: product.status,
  };

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="productId" value={product.id} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Details</h2>
        {canUpdate && !editing ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>

      {state.status === 'error' ? <FormAlert state={state} /> : null}
      {state.status === 'success' ? (
        <p className="text-xs text-muted-foreground" role="status">
          {state.message}
        </p>
      ) : null}

      <ProductCoreFields
        categories={categories}
        currency={currency}
        fieldErrors={fieldErrors}
        disabled={!editing}
        tracking={tracking}
        onTrackingChange={setTracking}
        defaults={defaults}
      />

      {editing ? (
        <div className="flex items-center justify-end gap-3">
          {/* A real reset restores the text inputs to what the server rendered; putting
              `tracking` back keeps the switch in step, since reset does not touch state. */}
          <Button
            type="reset"
            variant="ghost"
            onClick={() => {
              setTracking(product.trackInventory);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <SubmitButton pendingText="Saving…">Save details</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
