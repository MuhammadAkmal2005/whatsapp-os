import { Globe, Hand, PackageSearch, ShieldCheck } from 'lucide-react';

import { Reveal } from '@/components/marketing/reveal';

/**
 * The band under the hero.
 *
 * Four capabilities, not four numbers. A row of statistics is the conventional thing here and
 * we have no honest ones to put in it — no customer count, no messages-handled figure, and
 * inventing them would undermine the one claim the product genuinely rests on, which is that
 * it does not make things up.
 */

const POINTS = [
  {
    icon: ShieldCheck,
    title: 'Official WhatsApp platform',
    body: 'Meta’s own Business Platform and your own verified number — no browser tricks, nothing that gets a number banned.',
  },
  {
    icon: Globe,
    title: 'English, Urdu, Roman Urdu',
    body: 'Including the mix people actually type. “Bhai black wala XL available hai?” is understood as written.',
  },
  {
    icon: PackageSearch,
    title: 'Answers from your records',
    body: 'Prices, stock and policies are read from your catalogue and your saved answers, never improvised.',
  },
  {
    icon: Hand,
    title: 'Yours to take over',
    body: 'Step into any conversation and the AI stands down until you hand it back.',
  },
] as const;

export function ProofBand() {
  return (
    <section className="marketing-band relative overflow-hidden">
      <div className="container py-14 sm:py-16">
        <hr className="mk-rule" />
        <ul className="grid gap-8 pt-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
          {POINTS.map((point, index) => (
            <Reveal as="li" key={point.title} delay={index * 70} className="flex flex-col gap-2.5">
              <point.icon className="size-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">{point.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{point.body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
