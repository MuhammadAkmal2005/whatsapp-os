'use client';

/**
 * Stock, for one target: either the product itself or one of its sizes.
 *
 * `variantId` is an empty string for the product-level row and a uuid for a size — the
 * shape `variantTargetFrom` expects on the server, where empty means "the product" because
 * a hidden input cannot carry `null`.
 *
 * Three operations, kept as three separate forms on purpose. A *stocktake* ("there are 27")
 * is last-write-wins, which is right for a count someone just did. An *adjustment* ("12
 * arrived") is relative, so two people recording two deliveries at once both count. Folding
 * them into one field would silently lose one of the two behaviours — and it is the
 * delivery that would go missing. The threshold is the level at which the low-stock warning
 * fires, per target, because 3 is right for a wedding sherwani and 50 for plain socks.
 *
 * Collapsed to a one-line summary by default: a product with four sizes should not open as
 * four large stock panels. Whoever lacks `inventory:update` sees the summary and no forms —
 * the server refuses the write regardless, so hiding the controls is only tidiness.
 */

import { useActionState, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { IDLE_FORM_STATE, type FormState } from '@/lib/form-state';
import {
  adjustStockAction,
  setLowStockThresholdAction,
  setStockAction,
} from '@/server/actions/product.actions';

type StockAction = (prev: FormState, formData: FormData) => Promise<FormState>;

export function StockControls({
  productId,
  variantId,
  available,
  reserved,
  lowStockThreshold,
  canEdit,
}: {
  productId: string;
  /** Empty string for the product-level row; a variant uuid for a size. */
  variantId: string;
  available: number;
  reserved: number;
  lowStockThreshold: number;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isLow = available <= lowStockThreshold;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm text-foreground">
          <span className="font-semibold">{available}</span> available
        </span>
        {reserved > 0 ? (
          <span className="text-sm text-muted-foreground">· {reserved} reserved</span>
        ) : null}
        <span className="text-sm text-muted-foreground">· warn at {lowStockThreshold}</span>
        {isLow ? (
          <Badge variant={available <= 0 ? 'danger' : 'warning'}>
            {available <= 0 ? 'Out of stock' : 'Low'}
          </Badge>
        ) : null}
        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Done' : 'Update stock'}
          </Button>
        ) : null}
      </div>

      {canEdit && open ? (
        <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-3">
          <StockForm
            productId={productId}
            variantId={variantId}
            action={setStockAction}
            field="available"
            defaultValue={available}
            label="Set count"
            submitLabel="Set"
            helper="A stocktake — what is on the shelf right now."
          />
          <StockForm
            productId={productId}
            variantId={variantId}
            action={adjustStockAction}
            field="delta"
            label="Add or remove"
            submitLabel="Apply"
            placeholder="e.g. 12 or -2"
            helper="12 arrived, or -2 damaged."
            withReason
          />
          <StockForm
            productId={productId}
            variantId={variantId}
            action={setLowStockThresholdAction}
            field="lowStockThreshold"
            defaultValue={lowStockThreshold}
            label="Warn me at"
            submitLabel="Save"
            helper="Warned at this level or fewer."
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One numeric stock field with its own submit. Separate `useActionState` per form so a
 * success on the stocktake does not clear the message on the adjustment beside it, and so
 * the server's figure — "27 now available" — lands next to the field it came from.
 */
function StockForm({
  productId,
  variantId,
  action,
  field,
  defaultValue,
  label,
  submitLabel,
  helper,
  placeholder = '0',
  withReason = false,
}: {
  productId: string;
  variantId: string;
  action: StockAction;
  field: 'available' | 'delta' | 'lowStockThreshold';
  defaultValue?: number;
  label: string;
  submitLabel: string;
  helper: string;
  placeholder?: string;
  withReason?: boolean;
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const fieldError = state.status === 'error' ? state.fieldErrors?.[field]?.[0] : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variantId" value={variantId} />

      <FormField error={fieldError}>
        <FormLabel>{label}</FormLabel>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <FormControl>
              <Input
                name={field}
                inputMode="numeric"
                defaultValue={defaultValue}
                placeholder={placeholder}
                autoComplete="off"
              />
            </FormControl>
          </div>
          <SubmitButton variant="outline" pendingText="…">
            {submitLabel}
          </SubmitButton>
        </div>
        <FormDescription>{helper}</FormDescription>
      </FormField>

      {withReason ? (
        <Input name="reason" placeholder="Reason (optional)" autoComplete="off" />
      ) : null}

      {state.status === 'success' ? (
        <p role="status" className="text-xs font-medium text-emerald-600 dark:text-emerald-500">
          {state.message}
        </p>
      ) : null}
      {/* A business-rule refusal ("only 3 available") carries no field errors, so it would
          otherwise be invisible. Shown when the primary field itself did not error. */}
      {state.status === 'error' && !fieldError ? <FormAlert state={state} /> : null}
    </form>
  );
}
