'use client';

/**
 * Add a product.
 *
 * A full page, not a dialog: a product has a name, a price, a code, a category, a
 * couple of prices, stock figures and a status, and a dialog of ten fields on a phone
 * puts the keyboard over half of them. The create action redirects to the new
 * product's page on success, so this form only ever renders a failure — there is no
 * success state to show because the person is already somewhere else by then.
 *
 * The opening-stock fields appear only when the product tracks stock. They are
 * meaningless for a made-to-order item, and asking "how many do you have?" of a thing
 * that is stitched on demand is the kind of question that makes a shop owner distrust
 * the rest of the form.
 */

import Link from 'next/link';
import { useActionState, useState } from 'react';

import {
  ProductCoreFields,
  type Category,
} from '@/components/products/product-core-fields';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import type { SupportedCurrency } from '@/config/constants';
import { createProductAction } from '@/server/actions/product.actions';

export function CreateProductForm({
  categories,
  currency,
}: {
  categories: Category[];
  currency: SupportedCurrency;
}) {
  const [state, formAction] = useActionState(createProductAction, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  // Most clothing and e-commerce sellers count stock, so tracking is on by default —
  // and the default lives here, in a value the person can see and switch, rather than
  // hidden in a coercion rule. `ProductCoreFields` writes the hidden input from this.
  const [tracking, setTracking] = useState(true);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.status === 'error' ? <FormAlert state={state} /> : null}

      <ProductCoreFields
        categories={categories}
        currency={currency}
        fieldErrors={fieldErrors}
        tracking={tracking}
        onTrackingChange={setTracking}
      />

      {tracking ? (
        <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
          <FormField error={fieldErrors?.initialStock?.[0]}>
            <FormLabel>How many do you have?</FormLabel>
            <FormControl>
              <Input
                name="initialStock"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
              />
            </FormControl>
            <FormDescription>Your opening stock. You can correct it any time.</FormDescription>
          </FormField>

          <FormField error={fieldErrors?.lowStockThreshold?.[0]}>
            <FormLabel>Warn me when it drops to</FormLabel>
            <FormControl>
              <Input
                name="lowStockThreshold"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Optional"
              />
            </FormControl>
            <FormDescription>Leave empty to be warned only when it sells out.</FormDescription>
          </FormField>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Button asChild variant="ghost">
          <Link href="/products">Cancel</Link>
        </Button>
        <SubmitButton pendingText="Adding…">Add product</SubmitButton>
      </div>
    </form>
  );
}
