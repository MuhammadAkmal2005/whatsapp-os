import { Badge } from '@/components/ui/badge';
import { Reveal } from '@/components/marketing/reveal';
import { SectionHeading } from '@/components/marketing/section-heading';
import { MockBubble } from '@/components/marketing/product-mock/mock-bubble';
import { HandoffSatellite } from '@/components/marketing/product-mock/satellite-cards';

/**
 * The objection section.
 *
 * Anyone who has watched an AI assistant confidently invent a delivery date already has one
 * question about this product, and it is not "what can it do". So this section answers the
 * objection directly and shows the least flattering thing the assistant does — refusing — on
 * the grounds that it is also the most reassuring.
 */

const NEVER_IMPROVISED = [
  'Prices',
  'Stock',
  'Delivery times',
  'Discounts',
  'Return policy',
  'Order status',
  'Payment confirmation',
] as const;

const RULES = [
  {
    title: 'Every answer can be traced',
    body: 'In the test screen you see the product record or the saved answer each reply was built from. If nothing is listed, nothing was read.',
  },
  {
    title: 'No saved answer means no answer',
    body: 'A question you have never answered is not guessed at. It goes to you, with the reason it was escalated attached to the conversation.',
  },
  {
    title: 'Money is never the AI’s arithmetic',
    body: 'Order totals are recalculated on our server from your saved prices before anything is confirmed, whatever the chat said.',
  },
] as const;

export function AiSafety() {
  return (
    <section className="marketing-band relative overflow-hidden">
      <div className="container grid min-w-0 gap-12 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-16 lg:py-24">
        <div className="min-w-0">
          <Reveal variant="left">
            <SectionHeading
              eyebrow="The part everyone worries about"
              title="It would rather tell a customer it doesn’t know"
              lead="An assistant that invents a price is worse than no assistant at all. Every figure yours gives a customer is read from your catalogue or your saved answers — and when there is nothing to read, it stops and fetches you."
            />
          </Reveal>

          <Reveal variant="left" delay={80} className="mt-8">
            <p className="eyebrow">Never improvised</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {NEVER_IMPROVISED.map((item) => (
                <li key={item}>
                  <Badge variant="muted">{item}</Badge>
                </li>
              ))}
            </ul>
          </Reveal>

          <dl className="mt-10 flex flex-col">
            {RULES.map((rule, index) => (
              <Reveal
                as="div"
                key={rule.title}
                variant="left"
                delay={140 + index * 70}
                className="border-t border-border py-4"
              >
                <dt className="text-sm font-semibold text-foreground">{rule.title}</dt>
                <dd className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {rule.body}
                </dd>
              </Reveal>
            ))}
          </dl>
        </div>

        {/* The refusal, then its consequence. Read top to bottom it is one event: a question
            with no saved answer becomes a person's job, in two steps and without a caption. */}
        <Reveal variant="right" delay={120} className="min-w-0 lg:self-center">
          <figure className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="eyebrow">Live conversation</p>
              <div className="mt-3 flex flex-col gap-3">
                <MockBubble side="in" author="Ayesha K." meta="9:41 PM">
                  Agar size ka issue ho to exchange ho jayega?
                </MockBubble>
                <MockBubble side="out" meta="9:41 PM · Read">
                  Iska exact answer mere paas nahi hai — main aapko team se connect kar deta hoon,
                  woh confirm kar denge.
                </MockBubble>
              </div>
              <p className="mt-3 border-t border-border pt-3 text-2xs text-muted-foreground">
                No exchange policy saved · AI paused
              </p>
            </div>

            <HandoffSatellite className="w-full max-w-none" />

            <figcaption className="text-2xs leading-relaxed text-muted-foreground">
              A sample exchange. The refusal is not a setting you switch on — it is what happens
              whenever there is nothing in your records to answer with.
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
