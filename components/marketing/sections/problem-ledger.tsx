import { Reveal } from '@/components/marketing/reveal';
import { SectionHeading } from '@/components/marketing/section-heading';
import { APP_NAME } from '@/config/constants';

/**
 * The problem, as a ledger rather than a list of pain points.
 *
 * Two columns, one row per situation, so the reader is not asked to hold "here is the problem"
 * in their head for four paragraphs before "here is the answer" arrives. Every left-hand entry
 * is a real evening in a WhatsApp-run shop; every right-hand entry is something the product
 * actually does elsewhere on this page.
 */

const ROWS = [
  {
    situation: 'A price question at 1am',
    now: 'Answered at nine the next morning, if you remember.',
    then: 'Answered in seconds, with the price from your catalogue.',
  },
  {
    situation: 'Twelve people asking the same thing',
    now: 'You type the same three lines twelve times.',
    then: 'You answer it once, in your knowledge base, and never again.',
  },
  {
    situation: 'An order agreed in chat',
    now: 'Written on a notepad, or in your head, or nowhere.',
    then: 'Written into the order book with the totals already worked out.',
  },
  {
    situation: 'A customer who went quiet',
    now: 'Forgotten under two hundred newer messages.',
    then: 'Followed up on the schedule you set, without you remembering.',
  },
  {
    situation: 'A refund request',
    now: 'Found on Thursday, when the customer is already angry.',
    then: 'Handed straight to you, with the reason it was escalated.',
  },
] as const;

export function ProblemLedger() {
  return (
    <section className="border-b border-border bg-surface-panel">
      <div className="container py-16 sm:py-20 lg:py-24">
        <Reveal>
          <SectionHeading
            eyebrow="Sound familiar?"
            title="The messages are not the problem. Everything after them is."
            lead="WhatsApp is where your customers already are. What it does not do is remember, count, follow up, or work out a total while you are asleep."
          />
        </Reveal>

        <div className="mt-12">
          <div className="hidden grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)] gap-6 border-b border-border pb-3 sm:grid">
            <p className="eyebrow">Situation</p>
            <p className="eyebrow">On WhatsApp alone</p>
            <p className="eyebrow text-primary">With {APP_NAME}</p>
          </div>

          <ul className="flex flex-col">
            {ROWS.map((row, index) => (
              <Reveal
                as="li"
                key={row.situation}
                delay={index * 60}
                className="grid gap-3 border-b border-border py-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-6"
              >
                <p className="text-sm font-medium text-foreground">{row.situation}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{row.now}</p>
                {/* The rail is the page's one borrowed detail from the product itself, where it
                    marks the row you are working on. Here it marks the column that is the offer. */}
                <p className="marker-rail pl-4 text-sm leading-relaxed text-foreground">
                  {row.then}
                </p>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
