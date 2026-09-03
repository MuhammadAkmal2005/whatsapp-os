import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';

import { Atmosphere } from '@/components/marketing/atmosphere';
import { AppFrame } from '@/components/marketing/product-mock/app-frame';
import { InboxMock } from '@/components/marketing/product-mock/inbox-mock';
import {
  FollowUpSatellite,
  OrderSatellite,
} from '@/components/marketing/product-mock/satellite-cards';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/config/constants';
import { PLANS } from '@/config/plans';

/**
 * The hero.
 *
 * Two things govern its construction. The first is that it has to hold together between a
 * 360-pixel phone and a 1440-pixel laptop *and* at 720 pixels of height, so the vertical
 * rhythm is padding rather than a `min-h`, and the fold lands below the call to action at
 * every size rather than swallowing it.
 *
 * The second is containment. Nothing here is fixed-position, no satellite is offset further
 * than the container's own gutter, the satellites only appear at `xl` where that gutter is
 * wide enough to hold them, and the section clips. Between those four rules there is no
 * viewport at which a card can end up outside the hero.
 *
 * The entrance is one keyframe at eight delays — atmosphere, eyebrow, headline, supporting
 * line, buttons, assurance, frame, then the satellites. No client component, no observer, and
 * no JavaScript at all: it plays once on load, which is exactly what the browser's own
 * animation timeline is for.
 */

const ENTER = (delay: number) => ({ animationDelay: `${delay}ms` });

export function Hero() {
  return (
    <section className="marketing-band relative isolate flex flex-col justify-center overflow-hidden lg:min-h-[calc(100dvh-4rem)]">
      <Atmosphere />

      <div className="container relative grid gap-12 py-14 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-12 lg:py-16 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,31rem)] xl:gap-16 xl:py-20">
        <div className="flex min-w-0 max-w-xl flex-col items-start">
          <p
            className="inline-flex animate-mk-enter items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-2xs font-medium text-foreground"
            style={ENTER(60)}
          >
            <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-hidden />
            Official WhatsApp Business Platform
          </p>

          <h1 className="mk-display mt-5 animate-mk-enter text-foreground" style={ENTER(140)}>
            Your WhatsApp is already your shop.{' '}
            <span className="text-primary">Make it run like one.</span>
          </h1>

          <p
            className="mt-5 max-w-lg animate-mk-enter text-md leading-relaxed text-muted-foreground"
            style={ENTER(220)}
          >
            {APP_NAME} replies to your customers using your real prices and stock, writes the order
            down, remembers who they are — and hands the conversation to you the moment it should.
          </p>

          <div className="mt-8 flex animate-mk-enter flex-col gap-3 sm:flex-row" style={ENTER(300)}>
            <Button asChild size="lg" className="group">
              <Link href="/signup">
                Start free
                {/* Moves on hover and on keyboard focus alike, so the affordance is not
                    mouse-only. */}
                <ArrowRight className="transition-transform duration-fast ease-out group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="#how">See how it works</Link>
            </Button>
          </div>

          <p className="mt-5 animate-mk-enter text-xs text-muted-foreground" style={ENTER(380)}>
            {PLANS.starter.trialDays}-day free trial · No card to get started · Cancel whenever
          </p>
        </div>

        <div className="relative min-w-0">
          <div className="animate-mk-enter" style={ENTER(460)}>
            <AppFrame
              screen="Inbox"
              label="A customer asking about a black kurta in Roman Urdu, answered by the AI assistant with the price, delivery time and order total"
            >
              <InboxMock />
            </AppFrame>
          </div>

          {/* Offsets stay inside the container's own gutter, and both are `xl`-only because
              that is the first width at which the gutter is wide enough to lend. */}
          <div
            className="absolute -bottom-7 -left-10 hidden animate-mk-enter xl:block"
            style={ENTER(600)}
          >
            <OrderSatellite className="animate-mk-float" />
          </div>
          <div
            className="absolute -right-6 -top-7 hidden animate-mk-enter xl:block"
            style={ENTER(680)}
          >
            <FollowUpSatellite className="animate-mk-float-slow [animation-delay:-1.8s]" />
          </div>
        </div>
      </div>
    </section>
  );
}
