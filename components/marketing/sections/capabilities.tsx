import { CheckCheck, Coins, Filter, Package, ScrollText, Users } from 'lucide-react';

import { Reveal } from '@/components/marketing/reveal';
import { SectionHeading } from '@/components/marketing/section-heading';
import { AppFrame } from '@/components/marketing/product-mock/app-frame';
import { ContactMock } from '@/components/marketing/product-mock/contact-mock';
import { KnowledgeMock } from '@/components/marketing/product-mock/knowledge-mock';

/**
 * The feature section, composed as two split explanations followed by a ruled matrix.
 *
 * The two things that need a picture get one; the remaining six are one-line facts, and a
 * one-line fact does not deserve a card with an icon and a shadow. Drawing them as a matrix
 * with hairlines between the cells is also closer to what the product is — operational
 * software — than six floating panels would be.
 */

const MATRIX = [
  {
    icon: Users,
    title: 'Your team, with limits',
    body: 'An agent sees conversations. A manager sees orders and customers. Only an owner touches billing.',
  },
  {
    icon: Package,
    title: 'Products, variants and stock',
    body: 'Sizes, colours, SKUs and prices in one catalogue. Nothing is sold that your stock count says you do not have.',
  },
  {
    icon: Filter,
    title: 'Nothing sits unnoticed',
    body: 'Filter by unread, waiting on you, handled by the AI, assigned to a person, or by tag.',
  },
  {
    icon: CheckCheck,
    title: 'Sent, delivered, read',
    body: 'The states WhatsApp itself reports, kept against every message — so you know whether it was actually seen.',
  },
  {
    icon: Coins,
    title: 'What the AI costs you',
    body: 'Every reply is metered to your workspace with its token count and cost. The bill is never a surprise.',
  },
  {
    icon: ScrollText,
    title: 'A record of who changed what',
    body: 'Price edits, refunds, permission changes and sign-ins are written to an activity log you can export.',
  },
] as const;

const CRM_POINTS = [
  'Their orders, what they have spent, and when they last wrote',
  'Tags and private notes your team adds as they go',
  'Every earlier conversation, in one place',
] as const;

export function Capabilities() {
  return (
    <section id="features" className="scroll-mt-20 border-b border-border bg-background">
      <div className="container py-16 sm:py-20 lg:py-24">
        <Reveal>
          <SectionHeading
            eyebrow="What you get"
            title="A place to run the whole operation, not a widget bolted on"
            lead="The conversation is the front of it. Behind it sits the customer record, the catalogue, the order book and the log of what everyone did."
            className="max-w-2xl"
          />
        </Reveal>

        <div className="mt-14 grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-14">
          <Reveal variant="left">
            <h3 className="mk-display-sm text-foreground">A customer record that writes itself</h3>
            <p className="mt-3 max-w-prose text-base leading-relaxed text-muted-foreground">
              You already know Ayesha buys twice a year and always asks about delivery first. Right
              now that lives in your head. Here it is a record, built from the messages you were
              having anyway.
            </p>
            <ul className="mt-5 flex flex-col gap-2.5">
              {CRM_POINTS.map((point) => (
                <li
                  key={point}
                  className="marker-rail pl-4 text-sm leading-relaxed text-muted-foreground"
                >
                  {point}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal variant="right" delay={90}>
            <AppFrame
              screen="Customers"
              label="A customer record showing orders, total spent, tags and a note from a team member"
            >
              <ContactMock />
            </AppFrame>
          </Reveal>
        </div>

        <div className="mt-16 grid gap-8 lg:mt-20 lg:grid-cols-2 lg:items-center lg:gap-14">
          <Reveal variant="right">
            <h3 className="mk-display-sm text-foreground">Teach it once, in your own words</h3>
            <p className="mt-3 max-w-prose text-base leading-relaxed text-muted-foreground">
              Write your delivery and payment answers the way you would type them to a customer.
              Add the size guide as a PDF, or point it at a page on your own website. It reads
              them, and from then on it answers out of them.
            </p>
            <p className="mt-3 max-w-prose text-base leading-relaxed text-muted-foreground">
              Nothing else gets used. Take a source away and the assistant stops relying on it —
              which is the only way to be sure of what it will say.
            </p>
          </Reveal>

          <Reveal variant="left" delay={90} className="lg:order-first">
            <AppFrame
              screen="Knowledge"
              label="Four knowledge sources, three in use and one still being read"
            >
              <KnowledgeMock />
            </AppFrame>
          </Reveal>
        </div>

        {/* The hairlines are the parent showing through a 1px gap, which keeps every cell
            aligned no matter how much text one of them carries. */}
        <ul className="mt-16 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:mt-20 lg:grid-cols-3">
          {MATRIX.map((item, index) => (
            <Reveal
              as="li"
              key={item.title}
              delay={(index % 3) * 70}
              className="flex flex-col gap-2 bg-card p-5 sm:p-6"
            >
              <item.icon className="size-4 text-primary" aria-hidden />
              <h3 className="mt-1 text-base font-semibold tracking-tight text-foreground">
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
