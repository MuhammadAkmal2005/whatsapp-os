'use client';

/**
 * One size or colour on the product page.
 *
 * Reads as a line — label, price, and how many are left — until "Edit" is pressed, the
 * same look-first, edit-on-purpose shape the product details use. Its stock sits inside
 * the card because stock is counted per size once a product has any: the count a customer
 * is told about is this variant's, not the product's.
 *
 * Removal is a hard delete and the copy says as much, but it needs no typed confirmation
 * the way a whole product does. The order item keeps its own snapshot of what was sold, so
 * removing a size the shop no longer stocks loses nothing a past order relied on — it is a
 * reversible tidy, not a destructive one.
 */

import { Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';

import { ProductPrice, ProductStatusBadge } from '@/components/products/product-badges';
import { StockControls } from '@/components/products/stock-controls';
import { VariantForm } from '@/components/products/variant-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { SubmitButton } from '@/components/ui/submit-button';
import type { SupportedCurrency } from '@/config/constants';
import { IDLE_FORM_STATE } from '@/lib/form-state';
import { deleteVariantAction } from '@/server/actions/product.actions';
import type { ProductVariantView } from '@/server/services/product/product.service';

/** What a variant is called on screen. Everything present, joined — a size alone is the
 *  common case, but "XL · Black" and a named one-off both have to read cleanly. The schema
 *  guarantees at least one part, so the fallback is only a type-level safety net. */
export function variantLabel(variant: {
  size: string | null;
  color: string | null;
  name: string | null;
}): string {
  const parts = [variant.size, variant.color, variant.name].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Variant';
}

export function VariantCard({
  productId,
  variant,
  currency,
  tracksStock,
  canEditVariants,
  canEditStock,
}: {
  productId: string;
  variant: ProductVariantView;
  currency: SupportedCurrency;
  tracksStock: boolean;
  canEditVariants: boolean;
  canEditStock: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const label = variantLabel(variant);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          {variant.status !== 'ACTIVE' ? <ProductStatusBadge status={variant.status} /> : null}
          {variant.sku ? (
            <span className="text-xs text-muted-foreground">{variant.sku}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <ProductPrice price={variant.price} />
          {canEditVariants ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={editing}
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? 'Close' : 'Edit'}
            </Button>
          ) : null}
        </div>
      </div>

      {tracksStock && variant.stock ? (
        <StockControls
          productId={productId}
          variantId={variant.id}
          available={variant.stock.available}
          reserved={variant.stock.reserved}
          lowStockThreshold={variant.stock.lowStockThreshold}
          canEdit={canEditStock}
        />
      ) : null}

      {editing && canEditVariants ? (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <VariantForm
            productId={productId}
            currency={currency}
            mode="edit"
            variant={variant}
            onDone={() => setEditing(false)}
          />
          <RemoveVariant productId={productId} variantId={variant.id} label={label} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The confirm for removing a size. A dialog rather than an inline button because it is
 * still a delete, but without the typed-name gate a whole product carries: a size is
 * cheaper to recreate and its removal corrupts no past order. On success the action
 * revalidates the page and this card unmounts with the row, so there is no success state
 * to show here — only a failure needs rendering.
 */
function RemoveVariant({
  productId,
  variantId,
  label,
}: {
  productId: string;
  variantId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(deleteVariantAction, IDLE_FORM_STATE);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit text-destructive hover:text-destructive"
        >
          <Trash2 className="size-4" aria-hidden />
          Remove this size
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {label}?</DialogTitle>
          <DialogDescription>
            This size will be taken off the product and your AI will stop offering it. Past
            orders that included it keep their own record, so your history stays correct. You
            can add it again later.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="variantId" value={variantId} />
          {/* The parent id only revalidates the page after the delete — the service never
              receives it and it authorizes nothing. */}
          <input type="hidden" name="productId" value={productId} />

          {state.status === 'error' ? <FormAlert state={state} /> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep size
            </Button>
            <SubmitButton variant="destructive" pendingText="Removing…">
              Remove size
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
