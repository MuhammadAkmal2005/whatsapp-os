import { BookOpen, Package, ShieldQuestion } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { SAMPLE_ORDER } from '../sample-data';

/**
 * The test playground, showing the two answers that matter.
 *
 * The first is the easy one: a question the business has data for, answered with the sources
 * named underneath. The second is the one that decides whether a shop owner can leave the
 * assistant switched on — a question with no answer in the business's own records, where it
 * says so and hands over instead of inventing a policy.
 *
 * Showing the refusal on the public site is a product claim we can actually stand behind,
 * since it is enforced in the agent service and covered by tests.
 */
export function PlaygroundMock() {
  return (
    <div className="flex flex-col divide-y divide-border bg-card">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Customer</span> · black kurta XL hai? price
          kya hai?
        </p>
        <p className="text-sm leading-relaxed text-foreground">
          Jee, black kurta XL stock mein hai — {SAMPLE_ORDER.unitPrice}. {SAMPLE_ORDER.city} mein
          delivery 2–3 working days, aur COD bhi chalta hai.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
            Answered from
          </span>
          <Badge variant="muted" size="sm">
            <Package />
            Product: Black Kurta
          </Badge>
          <Badge variant="muted" size="sm">
            <BookOpen />
            Delivery &amp; payment FAQ
          </Badge>
          <Badge variant="success" size="sm">
            High confidence
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3 bg-surface-sunken p-4">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Customer</span> · exchange ki policy kya
          hai?
        </p>
        <p className="text-sm leading-relaxed text-foreground">
          Iska exact answer mere paas nahi hai — main aapko team se connect kar deta hoon, wo
          confirm kar denge.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
            No exchange policy saved
          </span>
          <Badge variant="warning" size="sm">
            <ShieldQuestion />
            Passed to a person
          </Badge>
        </div>
      </div>
    </div>
  );
}
