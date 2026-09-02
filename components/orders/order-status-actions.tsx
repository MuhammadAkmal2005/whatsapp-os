'use client';

/**
 * The controls that move an order along: confirm it, mark it shipped, mark it delivered —
 * and, set apart, cancel it.
 *
 * Only legal next steps are offered. The same transition map the service enforces
 * (`LEGAL_STATUS_TRANSITIONS`) decides which buttons appear, so the UI never shows a step
 * the server would reject. This is an affordance, not the enforcement: the service checks
 * the transition and the permission again on every call, because a form post does not have
 * to come from a page we drew.
 *
 * Cancellation is deliberately a separate, quieter path with a required reason. Cancelling
 * releases reserved stock, and "why" is the first thing a shop owner asks a week later, so
 * the reason is captured at the moment it is known rather than reconstructed.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { cancelOrder, updateOrderStatus } from '@/app/(app)/(workspace)/orders/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { FormControl, FormField, FormLabel } from '@/components/ui/form-field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ORDER_FIELD_MAX } from '@/server/validation/order';
import {
  LEGAL_STATUS_TRANSITIONS,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from '@/server/validation/order';
import type { OrderCapability } from '@/server/services/order/order.capability';

export function OrderStatusActions({
  orderId,
  status,
  can,
}: {
  orderId: string;
  status: OrderStatus;
  can: OrderCapability;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Cancellation is offered on its own, so it is filtered out of the forward steps here.
  const forwardSteps = LEGAL_STATUS_TRANSITIONS[status].filter((next) => next !== 'CANCELLED');
  const canCancel = can.cancel && LEGAL_STATUS_TRANSITIONS[status].includes('CANCELLED');

  // Nothing to offer: a terminal order, or a role that may neither advance nor cancel.
  if ((!can.updateStatus || forwardSteps.length === 0) && !canCancel) {
    return null;
  }

  function advance(next: OrderStatus) {
    setError(null);
    startTransition(async () => {
      const result = await updateOrderStatus(orderId, { status: next });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive" live="assertive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {can.updateStatus
          ? forwardSteps.map((next, index) => (
              <Button
                key={next}
                type="button"
                variant={index === 0 ? 'default' : 'outline'}
                size="sm"
                disabled={pending}
                onClick={() => advance(next)}
              >
                {pending ? <Spinner className="size-4" /> : null}
                {`Mark as ${ORDER_STATUS_LABELS[next].toLowerCase()}`}
              </Button>
            ))
          : null}

        {canCancel ? (
          <CancelOrderDialog orderId={orderId} disabled={pending} onError={setError} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The cancellation dialog. A required reason, because releasing stock and closing an order
 * is not something to do on a stray tap, and the reason is worth capturing while it is
 * known.
 */
function CancelOrderDialog({
  orderId,
  disabled,
  onError,
}: {
  orderId: string;
  disabled: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [dialogError, setDialogError] = useState<string | null>(null);

  const trimmed = reason.trim();

  function submit() {
    if (trimmed.length === 0) return;
    setDialogError(null);
    onError(null);
    startTransition(async () => {
      const result = await cancelOrder(orderId, { reason: trimmed });
      if (result.ok) {
        setOpen(false);
        setReason('');
        router.refresh();
      } else {
        setDialogError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason('');
          setDialogError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="text-destructive hover:text-destructive"
        >
          Cancel order
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this order?</DialogTitle>
          <DialogDescription>
            The items go back into your available stock and the order is closed. This cannot be
            undone — you would create a new order to sell the items again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {dialogError ? (
            <Alert variant="destructive" live="assertive">
              <AlertDescription>{dialogError}</AlertDescription>
            </Alert>
          ) : null}

          <FormField>
            <FormLabel>Reason for cancelling</FormLabel>
            <FormControl>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Customer changed their mind, or item out of stock"
                rows={3}
                maxLength={ORDER_FIELD_MAX.cancelReason}
                autoComplete="off"
              />
            </FormControl>
          </FormField>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Keep order
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || trimmed.length === 0}
            onClick={submit}
          >
            {pending ? <Spinner className="size-4" /> : null}
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
