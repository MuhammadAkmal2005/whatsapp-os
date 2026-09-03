import { Reveal } from '@/components/marketing/reveal';
import { SectionHeading } from '@/components/marketing/section-heading';
import { AnalyticsMock } from '@/components/marketing/product-mock/analytics-mock';
import { AppFrame } from '@/components/marketing/product-mock/app-frame';
import { AutomationMock } from '@/components/marketing/product-mock/automation-mock';
import { InboxMock } from '@/components/marketing/product-mock/inbox-mock';
import { OrderMock } from '@/components/marketing/product-mock/order-mock';
import { PlaygroundMock } from '@/components/marketing/product-mock/playground-mock';
import { Workflow, type WorkflowStep } from '@/components/marketing/workflow';

/**
 * How it works, told as one continuous scroll rather than four disconnected feature blocks.
 *
 * Each step's visual is a real product screen in a window frame, which is the whole reason the
 * section exists: a reader deciding whether to trust software with their customers wants to see
 * the software, not read an adjective about it.
 */

const STEPS: readonly WorkflowStep[] = [
  {
    id: 'arrives',
    kind: 'Step one',
    title: 'A customer messages your number',
    body: 'It lands in a proper inbox — searchable, assignable, with the whole history of that customer attached. Not a notification you will lose by tomorrow.',
    visual: (
      <AppFrame
        screen="Inbox"
        label="A shop inbox with four conversations, one being answered by the AI assistant"
      >
        <InboxMock />
      </AppFrame>
    ),
  },
  {
    id: 'answers',
    kind: 'Step two',
    title: 'Your AI answers out of your own records',
    body: 'It finds the product, checks the stock, quotes the price you set, and shows you what it used. Ask it something you never told it and it says so, then fetches a person.',
    visual: (
      <AppFrame
        screen="Test your AI"
        label="Two test answers: one citing a product and an FAQ, one declining to answer and escalating"
      >
        <PlaygroundMock />
      </AppFrame>
    ),
  },
  {
    id: 'orders',
    kind: 'Step three',
    title: 'The conversation turns into an order',
    body: 'Product, size, quantity, city, payment method — gathered in the chat, then priced on our own server from your catalogue, so the total is right even if the conversation was not.',
    visual: (
      <AppFrame screen="Orders" label="An order created from a conversation, with totals itemised">
        <OrderMock />
      </AppFrame>
    ),
  },
  {
    id: 'after',
    kind: 'Step four',
    title: 'And nothing is left for you to remember',
    body: 'Follow-ups, review requests and reminders run on the schedule you set, inside WhatsApp’s messaging rules — and stop the moment the customer replies.',
    visual: (
      <AppFrame screen="Automations" label="A post-delivery follow-up automation with four steps">
        <AutomationMock />
      </AppFrame>
    ),
  },
  {
    id: 'measure',
    kind: 'Step five',
    title: 'You find out what it did',
    body: 'How many conversations came in, how many the AI closed on its own, how many orders came out of them. A sample workspace is shown here — yours reports your own numbers.',
    visual: (
      <AppFrame screen="Dashboard" label="A dashboard showing conversation, AI-resolution and order figures for a sample workspace">
        <AnalyticsMock />
      </AppFrame>
    ),
  },
];

export function WorkflowSection() {
  return (
    <section id="how" className="scroll-mt-20 border-b border-border bg-background">
      <div className="container py-16 sm:py-20 lg:py-24">
        <Reveal>
          <SectionHeading
            eyebrow="How it works"
            title="One message, followed all the way through"
            lead="The same conversation, from the first “kya price hai?” to the follow-up two days after delivery."
            className="max-w-2xl"
          />
        </Reveal>

        <div className="mt-14">
          <Workflow steps={STEPS} />
        </div>
      </div>
    </section>
  );
}
