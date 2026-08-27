'use client';

/**
 * The catalogue fields shared by the create and the edit form.
 *
 * One component so the two forms cannot drift into offering different fields or
 * different help text for the same column — the specific failure that leaves a shop
 * owner able to set a weight when adding a product but not when editing it. The parts
 * that genuinely differ stay in the two parents: the create form adds opening-stock
 * fields, and the edit form wraps this in its disabled-until-Edit shell.
 *
 * `trackInventory` is controlled from the parent rather than held here, so the create
 * form can show or hide its stock section from the same boolean this switch writes.
 * A Radix switch posts nothing to the form, so the hidden input carries the value —
 * always 'true' or 'false', never absent, which is what `flagInput` needs to tell a
 * deliberate "do not track" apart from a field that was simply left off.
 */

import { forwardRef } from 'react';

import { Switch } from '@/components/ui/switch';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input, type InputProps } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { FieldErrors } from '@/lib/form-state';
import { currencySymbol } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { SupportedCurrency } from '@/config/constants';
import {
  PRODUCT_FIELD_MAX,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_DESCRIPTIONS,
  PRODUCT_STATUS_LABELS,
  type ProductStatus,
} from '@/server/validation/product';

/** Shared with the variant form so the two status pickers cannot drift into looking
 *  like different controls for the same choice. */
export const SELECT_CLASS =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

export type Category = { id: string; name: string };

/** Prefilled values for the edit form. Prices are display strings in *major* units —
 *  the caller converts from stored minor units — because that is what the person typed
 *  and expects to see, not `349900`. */
export type ProductFieldDefaults = {
  name?: string;
  description?: string;
  sku?: string;
  categoryId?: string;
  price?: string;
  salePrice?: string;
  weight?: string;
  status?: ProductStatus;
};

export function ProductCoreFields({
  categories,
  currency,
  fieldErrors,
  disabled = false,
  tracking,
  onTrackingChange,
  defaults = {},
}: {
  categories: Category[];
  currency: SupportedCurrency;
  fieldErrors?: FieldErrors;
  disabled?: boolean;
  tracking: boolean;
  onTrackingChange: (value: boolean) => void;
  defaults?: ProductFieldDefaults;
}) {
  const symbol = currencySymbol(currency);

  return (
    <div className="flex flex-col gap-4">
      <FormField error={fieldErrors?.name?.[0]}>
        <FormLabel>Product name</FormLabel>
        <FormControl>
          <Input
            name="name"
            defaultValue={defaults.name ?? ''}
            disabled={disabled}
            required
            autoComplete="off"
            placeholder="e.g. Black Cotton Kurta"
            maxLength={PRODUCT_FIELD_MAX.name}
          />
        </FormControl>
        <FormDescription>The name your customers would recognise it by.</FormDescription>
      </FormField>

      <FormField error={fieldErrors?.description?.[0]}>
        <FormLabel>Description</FormLabel>
        <FormControl>
          <Textarea
            name="description"
            defaultValue={defaults.description ?? ''}
            disabled={disabled}
            placeholder="Fabric, fit, care — anything your AI should be able to tell a customer."
            maxLength={PRODUCT_FIELD_MAX.description}
          />
        </FormControl>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.sku?.[0]}>
          <FormLabel>Product code (SKU)</FormLabel>
          <FormControl>
            <Input
              name="sku"
              defaultValue={defaults.sku ?? ''}
              disabled={disabled}
              autoComplete="off"
              placeholder="e.g. KURTA-BLK"
              maxLength={PRODUCT_FIELD_MAX.sku}
            />
          </FormControl>
          <FormDescription>Optional. Your own code for this item, if you use one.</FormDescription>
        </FormField>

        <FormField error={fieldErrors?.categoryId?.[0]}>
          <FormLabel>Category</FormLabel>
          <FormControl>
            <select
              name="categoryId"
              defaultValue={defaults.categoryId ?? ''}
              disabled={disabled}
              className={SELECT_CLASS}
            >
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </FormControl>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.priceMinor?.[0]}>
          <FormLabel>Price</FormLabel>
          <FormControl>
            <PriceInput
              name="priceMinor"
              symbol={symbol}
              defaultValue={defaults.price ?? ''}
              disabled={disabled}
              required
              placeholder="3499"
            />
          </FormControl>
        </FormField>

        <FormField error={fieldErrors?.salePriceMinor?.[0]}>
          <FormLabel>Sale price</FormLabel>
          <FormControl>
            <PriceInput
              name="salePriceMinor"
              symbol={symbol}
              defaultValue={defaults.salePrice ?? ''}
              disabled={disabled}
              placeholder="Optional"
            />
          </FormControl>
          <FormDescription>Leave empty if it is not on sale.</FormDescription>
        </FormField>
      </div>

      {/* Tracking is the switch that decides whether stock exists at all. Off is for a
          made-to-order item — a stitched sherwani — that has no shelf to count. */}
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
        <div className="min-w-0">
          <label htmlFor="track-inventory" className="text-sm font-medium text-foreground">
            Track stock for this product
          </label>
          <p className="mt-1 text-sm text-muted-foreground">
            Your AI will not sell it once it runs out, and you will be warned when it is running
            low. Turn this off for made-to-order items.
          </p>
        </div>
        <Switch
          id="track-inventory"
          checked={tracking}
          onCheckedChange={onTrackingChange}
          disabled={disabled}
          aria-label="Track stock for this product"
        />
        <input type="hidden" name="trackInventory" value={tracking ? 'true' : 'false'} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors?.status?.[0]}>
          <FormLabel>Status</FormLabel>
          <FormControl>
            <select
              name="status"
              defaultValue={defaults.status ?? 'ACTIVE'}
              disabled={disabled}
              className={SELECT_CLASS}
            >
              {PRODUCT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PRODUCT_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </FormControl>
          <FormDescription>{PRODUCT_STATUS_DESCRIPTIONS[defaults.status ?? 'ACTIVE']}</FormDescription>
        </FormField>

        <FormField error={fieldErrors?.weightGrams?.[0]}>
          <FormLabel>Weight (grams)</FormLabel>
          <FormControl>
            <Input
              name="weightGrams"
              type="text"
              inputMode="numeric"
              defaultValue={defaults.weight ?? ''}
              disabled={disabled}
              autoComplete="off"
              placeholder="Optional"
            />
          </FormControl>
          <FormDescription>Used later to work out delivery charges.</FormDescription>
        </FormField>
      </div>
    </div>
  );
}

/**
 * A price field with the workspace's currency symbol set inside it, so a shop owner
 * types `3499` and sees `Rs. 3499` rather than wondering which unit the box wants.
 * The value posts as the plain string the person typed; the service reads the currency
 * from the workspace and converts. `inputMode="decimal"` brings up the number pad with
 * a decimal point on a phone, which is where most of these are typed.
 *
 * A `forwardRef` that passes everything through to the inner `Input`, because
 * `FormControl` injects the field id and the aria wiring onto its child via a `Slot`.
 * If those landed on the positioning `<div>` instead of the `<input>`, the label would
 * point at nothing and the error would not be announced.
 */
const PriceInput = forwardRef<HTMLInputElement, InputProps & { symbol: string }>(
  ({ symbol, className, ...props }, ref) => (
    <div className="relative">
      <span
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
        aria-hidden
      >
        {symbol}
      </span>
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn('ps-12', className)}
        maxLength={PRODUCT_FIELD_MAX.price}
        {...props}
      />
    </div>
  ),
);
PriceInput.displayName = 'PriceInput';
