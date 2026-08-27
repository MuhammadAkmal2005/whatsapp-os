'use client';

/**
 * Add or edit one size or colour.
 *
 * One form for both, because the fields are the same and two of them would drift — the
 * exact failure `ProductCoreFields` exists to prevent, one level down. What genuinely
 * differs is small and switched on `mode`: a new variant asks for opening stock and lets
 * its status default to active, while editing an existing one exposes the status picker so
 * a discontinued size can be archived without being deleted.
 *
 * A variant price is an **override**. Empty does not mean "free" — it means "charge the
 * product's price", which is the ordinary case for an XL that costs the same as the M. So
 * the price fields are seeded from the stored overrides when editing, and a blank one saves
 * as null rather than zero; `optionalPriceInput` in the schema is what makes that safe.
 */

import { useActionState, useEffect } from 'react';

import { SELECT_CLASS } from '@/components/products/product-core-fields';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import type { SupportedCurrency } from '@/config/constants';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { currencySymbol, money, toMajor } from '@/lib/money';
import { createVariantAction, updateVariantAction } from '@/server/actions/product.actions';
import type { ProductVariantView } from '@/server/services/product/product.service';
import {
  PRODUCT_FIELD_MAX,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
} from '@/server/validation/product';

export function VariantForm({
  productId,
  currency,
  mode,
  variant,
  onDone,
}: {
  productId: string;
  currency: SupportedCurrency;
  mode: 'create' | 'edit';
  /** The variant being edited. Required when `mode` is `edit`, ignored otherwise. */
  variant?: ProductVariantView;
  /** Called after a successful save, so the parent can collapse the form. */
  onDone?: () => void;
}) {
  const action = mode === 'create' ? createVariantAction : updateVariantAction;
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state.status === 'success') onDone?.();
  }, [state, onDone]);

  const symbol = currencySymbol(currency);
  const toDisplay = (minor: number | null | undefined) =>
    minor === null || minor === undefined ? '' : String(toMajor(money(minor, currency)));

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {/* Create posts the parent id; edit posts the variant's own id and lets the service
          read the parent from the row, so a tampered parent id cannot move a variant. */}
      {mode === 'create' ? (
        <input type="hidden" name="productId" value={productId} />
      ) : (
        <input type="hidden" name="variantId" value={variant?.id ?? ''} />
      )}

      {state.status === 'error' ? <FormAlert state={state} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.size?.[0]}>
          <FormLabel>Size</FormLabel>
          <FormControl>
            <Input
              name="size"
              defaultValue={variant?.size ?? ''}
              autoComplete="off"
              placeholder="e.g. XL"
              maxLength={PRODUCT_FIELD_MAX.variantLabel}
            />
          </FormControl>
        </FormField>

        <FormField error={fieldErrors?.color?.[0]}>
          <FormLabel>Colour</FormLabel>
          <FormControl>
            <Input
              name="color"
              defaultValue={variant?.color ?? ''}
              autoComplete="off"
              placeholder="e.g. Black"
              maxLength={PRODUCT_FIELD_MAX.variantLabel}
            />
          </FormControl>
        </FormField>
      </div>

      <FormField error={fieldErrors?.name?.[0]}>
        <FormLabel>Name</FormLabel>
        <FormControl>
          <Input
            name="name"
            defaultValue={variant?.name ?? ''}
            autoComplete="off"
            placeholder="Optional"
            maxLength={PRODUCT_FIELD_MAX.variantLabel}
          />
        </FormControl>
        <FormDescription>Only if a size and colour do not describe it on their own.</FormDescription>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.sku?.[0]}>
          <FormLabel>Product code (SKU)</FormLabel>
          <FormControl>
            <Input
              name="sku"
              defaultValue={variant?.sku ?? ''}
              autoComplete="off"
              placeholder="e.g. KURTA-BLK-XL"
              maxLength={PRODUCT_FIELD_MAX.sku}
            />
          </FormControl>
        </FormField>

        {mode === 'edit' ? (
          <FormField error={fieldErrors?.status?.[0]}>
            <FormLabel>Status</FormLabel>
            <FormControl>
              <select name="status" defaultValue={variant?.status ?? 'ACTIVE'} className={SELECT_CLASS}>
                {PRODUCT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {PRODUCT_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </FormControl>
            <FormDescription>Archive a size you have stopped stocking.</FormDescription>
          </FormField>
        ) : (
          <FormField error={fieldErrors?.initialStock?.[0]}>
            <FormLabel>How many do you have?</FormLabel>
            <FormControl>
              <Input
                name="initialStock"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
              />
            </FormControl>
            <FormDescription>Opening stock for this size. You can correct it any time.</FormDescription>
          </FormField>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.priceMinor?.[0]}>
          <FormLabel>Price for this size ({symbol})</FormLabel>
          <FormControl>
            <Input
              name="priceMinor"
              inputMode="decimal"
              defaultValue={toDisplay(variant?.priceMinor)}
              autoComplete="off"
              placeholder="Same as product"
              maxLength={PRODUCT_FIELD_MAX.price}
            />
          </FormControl>
          <FormDescription>Leave empty to charge the product price.</FormDescription>
        </FormField>

        <FormField error={fieldErrors?.salePriceMinor?.[0]}>
          <FormLabel>Sale price ({symbol})</FormLabel>
          <FormControl>
            <Input
              name="salePriceMinor"
              inputMode="decimal"
              defaultValue={toDisplay(variant?.salePriceMinor)}
              autoComplete="off"
              placeholder="Optional"
              maxLength={PRODUCT_FIELD_MAX.price}
            />
          </FormControl>
        </FormField>
      </div>

      <div className="flex items-center justify-end gap-3">
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
        <SubmitButton pendingText="Saving…">
          {mode === 'create' ? 'Add size' : 'Save size'}
        </SubmitButton>
      </div>
    </form>
  );
}
