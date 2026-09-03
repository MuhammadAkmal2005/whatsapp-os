import { ArrowRightLeft, CheckCircle2, Clock } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { SAMPLE_ORDER } from '../sample-data';

/**
 * The small cards that sit around the hero's inbox frame.
 *
 * Each one names a different thing the product did without being asked — an order written
 * up, a refund passed to a person, a follow-up queued — because those three are the actual
 * argument for the product, and a caption cannot make them as concrete as a card can.
 *
 * They are positioned by the hero, not here: a component that places itself absolutely is a
 * component that escapes its container the first time it is reused.
 */

interface SatelliteProps {
  className?: string;
}

function Satellite({
  icon,
  eyebrow,
  className,
  children,
}: SatelliteProps & { icon: ReactNode; eyebrow: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'w-max max-w-[15rem] rounded-lg border border-border bg-popover p-3 shadow-overlay',
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-primary">
        {icon}
        <span className="text-3xs font-semibold uppercase tracking-wide">{eyebrow}</span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function OrderSatellite({ className }: SatelliteProps) {
  return (
    <Satellite
      icon={<CheckCircle2 className="size-3.5" />}
      eyebrow="Order created"
      className={className}
    >
      <p className="text-xs font-medium text-popover-foreground">
        {SAMPLE_ORDER.productName} · {SAMPLE_ORDER.variant} × {SAMPLE_ORDER.quantity}
      </p>
      <dl className="mt-2 flex flex-col gap-1 text-3xs">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums text-popover-foreground">{SAMPLE_ORDER.subtotal}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Delivery</dt>
          <dd className="tabular-nums text-popover-foreground">{SAMPLE_ORDER.delivery}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-1">
          <dt className="font-medium text-popover-foreground">Total</dt>
          <dd className="font-semibold tabular-nums text-primary">{SAMPLE_ORDER.total}</dd>
        </div>
      </dl>
    </Satellite>
  );
}

export function HandoffSatellite({ className }: SatelliteProps) {
  return (
    <Satellite
      icon={<ArrowRightLeft className="size-3.5" />}
      eyebrow="Passed to you"
      className={className}
    >
      <p className="text-xs font-medium text-popover-foreground">Bilal R. asked for a refund</p>
      <p className="mt-1 text-3xs leading-relaxed text-muted-foreground">
        Refunds always go to a person. Assigned to Sana.
      </p>
    </Satellite>
  );
}

export function FollowUpSatellite({ className }: SatelliteProps) {
  return (
    <Satellite
      icon={<Clock className="size-3.5" />}
      eyebrow="Follow-up queued"
      className={className}
    >
      <p className="text-xs font-medium text-popover-foreground">2 days after delivery</p>
      <p className="mt-1 text-3xs leading-relaxed text-muted-foreground">
        Ask Ayesha how the kurta fits.
      </p>
    </Satellite>
  );
}
