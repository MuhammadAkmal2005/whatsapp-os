import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { Atmosphere } from '@/components/marketing/atmosphere';
import { Reveal } from '@/components/marketing/reveal';
import { Button } from '@/components/ui/button';
import { PLANS } from '@/config/plans';

/**
 * The closing ask.
 *
 * Deliberately the shortest section on the page: by this point the argument has been made and
 * anything else added here is only something new to read instead of clicking. The four steps
 * are named because "get started" hides how much work it is, and the honest answer — connect,
 * teach, test, go live — is short enough to be reassuring.
 */

const STEPS = ['Connect your number', 'Add your products', 'Test the answers', 'Go live'] as const;

export function FinalCta() {
  return (
    <section className="marketing-ink relative isolate overflow-hidden">
      <Atmosphere />

      <div className="container relative flex flex-col items-center gap-6 py-20 text-center sm:py-24">
        <Reveal>
          <h2 className="mk-display mx-auto max-w-3xl text-foreground">
            Your customers are already typing. <span className="text-primary">Answer them.</span>
          </h2>
        </Reveal>

        <Reveal delay={80}>
          <p className="mx-auto max-w-xl text-md leading-relaxed text-muted-foreground">
            Connect the number you already use, teach it about your shop, and let it take the
            questions you have answered a thousand times.
          </p>
        </Reveal>

        <Reveal delay={160} className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="group">
            <Link href="/signup">
              Start free
              <ArrowRight
                className="size-4 transition-transform duration-fast ease-out group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </Reveal>

        <Reveal delay={240} className="flex flex-col items-center gap-3">
          <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {STEPS.map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                {index > 0 ? (
                  <span aria-hidden className="text-border-strong">
                    ·
                  </span>
                ) : null}
                {step}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Free plan with no time limit · {PLANS.starter.trialDays}-day trial on paid plans · No
            card to start
          </p>
        </Reveal>
      </div>
    </section>
  );
}
