import { FaqAccordion, type FaqItem } from '@/components/marketing/faq-accordion';
import { Reveal } from '@/components/marketing/reveal';
import { SectionHeading } from '@/components/marketing/section-heading';
import { APP_NAME } from '@/config/constants';

/**
 * The questions a shop owner actually asks before trusting software with their customers.
 *
 * Every answer here is one the product can keep. The ban question is first because it is the
 * first thing anyone who has heard of a blocked number wants to know, and the Meta charges
 * answer exists because finding out about a per-conversation fee after signing up is the kind
 * of surprise that loses a customer permanently.
 */

const FAQS: readonly FaqItem[] = [
  {
    question: 'Is this official WhatsApp, or a workaround?',
    answer: `Official. ${APP_NAME} connects through Meta’s WhatsApp Business Platform using your own verified number. There is no QR-code trick, no browser automation and no scraping — the things that get numbers banned.`,
  },
  {
    question: 'Will the AI invent prices or stock?',
    answer:
      'No. Prices, stock, delivery times and policies are read from your catalogue and your saved answers. When there is nothing to read, it tells the customer it does not have that answer and passes the conversation to you, with the reason attached.',
  },
  {
    question: 'Does it understand Urdu and Roman Urdu?',
    answer:
      'Yes — English, Urdu, Roman Urdu, and the mix people actually type. “Bhai black wala XL available hai?” is understood as written, and the reply comes back in the same style. You choose the tone.',
  },
  {
    question: 'Can I take over a conversation myself?',
    answer:
      'At any point. Open the chat, start typing, and the AI stands down on that conversation until you hand it back. Refunds, complaints and anything sensitive are handed to you without being asked.',
  },
  {
    question: 'Is there anything to pay besides the plan?',
    answer:
      'Meta charges for WhatsApp conversations on its own rates, billed to your WhatsApp Business account rather than through us. Your plan here covers the software and the AI replies it makes.',
  },
  {
    question: 'What kind of business is this built for?',
    answer:
      'Online clothing and e-commerce sellers in Pakistan first, because their WhatsApp day is the most repetitive. Anything that sells and supports customers over WhatsApp works the same way.',
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-20 border-b border-border bg-surface-panel">
      <div className="container grid gap-8 py-16 sm:py-20 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-16 lg:py-24">
        <Reveal variant="left">
          <SectionHeading
            eyebrow="Before you ask"
            title="Questions, answered"
            lead="The five-minute version of what this is and is not."
          />
        </Reveal>

        <Reveal variant="up" delay={90}>
          <FaqAccordion items={FAQS} />
        </Reveal>
      </div>
    </section>
  );
}
