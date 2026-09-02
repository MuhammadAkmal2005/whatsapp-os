import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Clock,
  MessageSquareText,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PLANS } from '@/config/plans';
import { formatMoney, money } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * The landing page.
 *
 * The one thing this page has to do is make a shop owner recognise their own working day and
 * then see it handled. So the hero's right-hand side is not an illustration of messaging —
 * it is the product's own inbox geometry, the same bubbles and the same order summary, with a
 * real Roman-Urdu exchange running through it. Everything else on the page is deliberately
 * quiet so that panel is the thing remembered.
 *
 * No gradient wash, no floating cards on shadows, no alternating grey stripes: sections are
 * separated by hairlines and one sunken band, and the capability grid is drawn as a ruled
 * matrix rather than as six cards, because this is operational software and it should look
 * like it. Every price and total shown is arithmetically correct — a landing page that cannot
 * add up is not a good advertisement for an order system.
 */

const starterPrice = formatMoney(money(PLANS.starter.priceMinor, PLANS.starter.currency));

const PROOF_POINTS = [
  { icon: ShieldCheck, label: 'Official WhatsApp Business Platform' },
  { icon: MessageSquareText, label: 'English, Urdu and Roman Urdu' },
  { icon: Clock, label: 'Answers in seconds, day and night' },
];

const PAINS = [
  '“Price kya hai?” — answered for the hundredth time today.',
  'A payment screenshot arrives at 2am. Nobody replies until morning.',
  'The follow-up never happens, and the sale goes cold.',
  'Orders live in chat scrollback instead of somewhere you can trust.',
];

const STEPS = [
  {
    title: 'Connect WhatsApp',
    body: 'Link your official WhatsApp Business number. Messages start arriving in your inbox right away.',
  },
  {
    title: 'Teach your AI',
    body: 'Add your products, prices and a few FAQs. Test it in the playground until it sounds like your shop.',
  },
  {
    title: 'Go live',
    body: 'Let it handle the routine questions and orders. Step in whenever you want — you stay in control.',
  },
];

const FEATURES = [
  {
    icon: MessageSquareText,
    title: 'One shared inbox',
    body: 'Every WhatsApp chat in one place, with search, filters, assignment and status — so nothing is lost in a personal phone.',
  },
  {
    icon: Sparkles,
    title: 'An AI that knows your shop',
    body: 'It answers from your real prices, stock and policies. When it does not know, it says so and hands the chat to you.',
  },
  {
    icon: ShoppingBag,
    title: 'Orders, captured',
    body: 'Collect product, size, quantity and address in chat, then raise an order with the totals worked out on our server.',
  },
  {
    icon: Users,
    title: 'A customer record that builds itself',
    body: 'Every contact, their orders, spend and history — kept current from the conversations you are already having.',
  },
  {
    icon: BookOpen,
    title: 'Teach it once',
    body: 'Add your FAQs, delivery and return policies. Your assistant answers from them instead of guessing.',
  },
  {
    icon: Workflow,
    title: 'Follow-ups that happen',
    body: 'Nudge a quiet chat, ask for a review after delivery, remind about an appointment — without remembering to.',
  },
];

const AI_PROMISES = [
  'Grounded in your prices, stock and policies — never invented',
  'Escalates refunds, complaints and anything sensitive to you',
  'Shows you what it used to answer, before you go live',
];

const FAQS = [
  {
    q: 'Is this official WhatsApp, or a workaround?',
    a: 'Official. ConvoNexa connects through the WhatsApp Business Platform (Cloud API). There is no QR-code trick and no web scraping, so your number stays safe and compliant.',
  },
  {
    q: 'Will the AI make up prices or stock?',
    a: 'No. It only states prices, stock, delivery times and policies that come from your own data. If it does not have the answer it tells the customer and hands the chat to your team.',
  },
  {
    q: 'Does it understand Urdu and Roman Urdu?',
    a: 'Yes. It handles English, Urdu and Roman Urdu — including mixed messages like “bhai black wala XL available hai?” — and replies in the same style.',
  },
  {
    q: 'Can I take over a conversation myself?',
    a: 'Any time. Pause the AI on a single chat, reply yourself, and switch it back on when you are done. Sensitive or angry conversations are handed to you automatically.',
  },
  {
    q: 'What kind of business is this for?',
    a: 'It is built first for online clothing and e-commerce sellers in Pakistan, and works for any business that sells and supports customers over WhatsApp.',
  },
];

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="container grid gap-14 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-16 lg:py-24">
        <div className="flex flex-col items-start gap-6">
          <p className="eyebrow flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-primary" aria-hidden />
            Your AI employee for WhatsApp
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Turn WhatsApp into your <span className="text-primary">business operating system</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            Answer customers, capture leads, raise orders and keep every customer record up to
            date — from the number they already message you on, in English, Urdu and Roman Urdu.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Start free
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/#how">See how it works</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Free to start · No card required · Your first number in minutes
          </p>
        </div>

        <ConversationPanel />
      </section>

      {/* ── Proof strip ──────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-surface-sunken" aria-label="Why it is safe">
        <ul className="container grid gap-4 py-7 sm:grid-cols-3">
          {PROOF_POINTS.map((point) => (
            <li key={point.label} className="flex items-center justify-center gap-2.5 text-center">
              <point.icon className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="text-sm font-medium">{point.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── The problem, then the sequence that answers it ───────────────── */}
      <section className="container grid gap-12 py-20 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-20">
        <div className="flex flex-col gap-4">
          <h2 className="text-3xl font-semibold tracking-tight">Sound familiar?</h2>
          <p className="max-w-prose leading-relaxed text-muted-foreground">
            You are the sales team, the support team and the order desk at once — answering the
            same questions all day while real orders slip past at night.
          </p>
        </div>
        <ul className="flex flex-col">
          {PAINS.map((pain) => (
            <li
              key={pain}
              className="border-t border-border py-4 text-md leading-snug last:border-b"
            >
              {pain}
            </li>
          ))}
        </ul>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" className="border-t border-border bg-surface-sunken py-20">
        <div className="container">
          <div className="flex flex-col gap-4">
            <h2 className="text-3xl font-semibold tracking-tight">Live in three steps</h2>
            <p className="max-w-prose leading-relaxed text-muted-foreground">
              Nothing to install and no developer needed. If you can use WhatsApp, you can set
              this up.
            </p>
          </div>
          {/* Numbered because the order genuinely matters: there is nothing to teach the AI
              until the number is connected, and nothing to go live with until it is taught. */}
          <ol className="mt-12 grid gap-8 md:grid-cols-3 md:gap-10">
            {STEPS.map((step, index) => (
              <li key={step.title} className="border-t-2 border-primary-border pt-5">
                <p className="eyebrow tabular-nums">Step {index + 1}</p>
                <h3 className="mt-2 text-lg font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="container py-20">
        <div className="flex flex-col gap-4">
          <h2 className="text-3xl font-semibold tracking-tight">
            Everything your WhatsApp operation needs
          </h2>
          <p className="max-w-prose leading-relaxed text-muted-foreground">
            Not a chatbot bolted on to a website. A place to run sales, support and orders, with
            the AI doing the repetitive part.
          </p>
        </div>
        {/* A ruled matrix rather than six floating cards: the hairlines come from the parent
            showing through a 1px gap, which keeps every cell exactly aligned. */}
        <ul className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="flex flex-col gap-2 bg-card p-6">
              <feature.icon className="size-4 text-primary" aria-hidden />
              <h3 className="mt-1 text-base font-semibold tracking-tight">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── The AI employee, and the evidence behind its answers ─────────── */}
      <section className="border-y border-border bg-surface-sunken py-20">
        <div className="container grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div className="flex flex-col items-start gap-5">
            <p className="eyebrow flex items-center gap-1.5">
              <Bot className="size-3.5 text-ai" aria-hidden />
              Meet your AI employee
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              It works your hours — and the ones you cannot
            </h2>
            <p className="max-w-prose leading-relaxed text-muted-foreground">
              Give your assistant a name, a tone and the languages your customers use. It greets
              buyers, answers from your catalogue, qualifies leads and starts orders — then hands
              the difficult ones to you with the whole conversation in front of you.
            </p>
            <ul className="flex flex-col gap-3">
              {AI_PROMISES.map((promise) => (
                <li key={promise} className="flex items-start gap-2.5 text-sm leading-snug">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{promise}</span>
                </li>
              ))}
            </ul>
            <Button asChild>
              <Link href="/signup">
                Build your AI employee
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>

          <PlaygroundPanel />
        </div>
      </section>

      {/* ── Pricing teaser ───────────────────────────────────────────────── */}
      <section className="container flex flex-col items-center gap-5 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Simple, honest pricing</h2>
        <p className="max-w-prose leading-relaxed text-muted-foreground">
          Start free on one number. Upgrade when your shop is busy enough to need it — plans from{' '}
          <span className="font-medium text-foreground">{starterPrice} a month</span>.
        </p>
        <Button asChild size="lg" variant="outline">
          <Link href="/pricing">
            Compare the plans
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="border-t border-border bg-surface-sunken py-20">
        <div className="container max-w-3xl">
          <h2 className="text-3xl font-semibold tracking-tight">Questions, answered</h2>
          <div className="mt-10 flex flex-col gap-3">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group rounded-lg border border-border bg-card">
                {/* `list-none` plus the WebKit pseudo-element removes the default marker in
                    every engine; `marker:content-none` alone leaves Safari's triangle. */}
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left font-medium [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-fast ease-out group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <p className="max-w-prose px-5 pb-4 text-sm leading-relaxed text-muted-foreground">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="bg-sidebar py-20 text-sidebar-foreground">
        <div className="container flex max-w-2xl flex-col items-center gap-5 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-sidebar-strong">
            Ready to let your AI take the messages?
          </h2>
          <p className="leading-relaxed">
            Connect your number, teach it about your shop, and watch orders arrive while you get on
            with the business.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Start free
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-sidebar-border bg-transparent text-sidebar-strong hover:bg-sidebar-selected hover:text-sidebar-strong"
            >
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * The product's own inbox, in miniature.
 *
 * Deliberately the same geometry as `components/inbox/*`: a card-coloured thread header, the
 * thread itself on the sunken surface, bubbles with one squared corner on the sender's side,
 * and the order summary underneath. Static markup — it illustrates the product rather than
 * claiming to be a live session — but every figure adds up: 3,499 × 2 = 6,998, plus 250
 * delivery, is 7,248.
 */
function ConversationPanel() {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase text-muted-foreground"
        >
          AK
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Ayesha K.</p>
          <p className="truncate text-2xs text-muted-foreground">Karachi · Returning customer</p>
        </div>
        <Badge variant="ai" size="sm" className="shrink-0 gap-1">
          <Bot aria-hidden />
          AI replying
        </Badge>
      </div>

      <ol className="flex flex-col gap-2.5 bg-surface-sunken px-4 py-4">
        <MockBubble side="in" time="10:42">
          AOA, black kurta XL available hai?
        </MockBubble>
        <MockBubble side="out" sender="Your AI" time="10:42">
          Jee bilkul! Black kurta XL available hai — <strong>Rs. 3,499</strong>. COD bhi chalta
          hai. Kitne chahiye?
        </MockBubble>
        <MockBubble side="in" time="10:44">
          2 chahiye. Karachi deliver ho jayega?
        </MockBubble>
        <MockBubble side="out" sender="Your AI" time="10:45">
          Karachi 2–3 working days. Address bhej dein, main order bana deti hoon.
        </MockBubble>
      </ol>

      <div className="border-t border-border px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">Order from this chat</p>
          <Badge variant="muted" size="sm" className="shrink-0">
            Cash on delivery
          </Badge>
        </div>
        <dl className="mt-2.5 flex flex-col gap-1 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 truncate">Black Kurta (XL) × 2</dt>
            <dd className="shrink-0 font-mono tabular-nums">Rs. 6,998</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
            <dt>Delivery</dt>
            <dd className="shrink-0 font-mono tabular-nums">Rs. 250</dd>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-border pt-2 font-semibold">
            <dt>Total</dt>
            <dd className="shrink-0 font-mono tabular-nums">Rs. 7,248</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/** A bubble drawn to the same rules as the real thread: system radius, one squared corner
 *  on the sender's side, attribution above rather than inside. */
function MockBubble({
  side,
  sender,
  time,
  children,
}: {
  side: 'in' | 'out';
  sender?: string;
  time: string;
  children: React.ReactNode;
}) {
  const isOut = side === 'out';

  return (
    <li className={cn('flex w-full flex-col gap-1', isOut ? 'items-end' : 'items-start')}>
      {sender ? (
        <span className="flex items-center gap-1 px-0.5 text-2xs font-medium text-muted-foreground">
          <Bot className="size-3 text-ai" aria-hidden />
          {sender}
        </span>
      ) : null}
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isOut
            ? 'rounded-br-xs bg-primary text-primary-foreground'
            : 'rounded-bl-xs border border-border bg-card text-foreground',
        )}
      >
        <p className="leading-relaxed">{children}</p>
        <p
          className={cn(
            'mt-1 text-right text-3xs tabular-nums',
            isOut ? 'text-primary-foreground/80' : 'text-muted-foreground',
          )}
        >
          {time}
        </p>
      </div>
    </li>
  );
}

/**
 * The test playground, in miniature: the question, the answer, and the evidence the answer
 * was built from. The evidence row is the product's central promise made visible — an answer
 * with no source behind it is one the assistant is not allowed to give.
 */
function PlaygroundPanel() {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
        <Sparkles className="size-4 text-primary" aria-hidden />
        AI test playground
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="rounded-md border border-border bg-surface-sunken p-3">
          <p className="eyebrow">Customer</p>
          <p className="mt-1 text-sm">What is your return policy for stitched clothes?</p>
        </div>

        <div className="rounded-md border border-ai-border bg-ai-surface p-3">
          <p className="eyebrow text-ai">Assistant</p>
          <p className="mt-1 text-sm leading-relaxed">
            Stitched items can be exchanged within 7 days if unworn, with the receipt. Refunds are
            store credit. Shall I send you the return address?
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="eyebrow">Answered from</span>
          <Badge variant="muted" size="sm" className="gap-1">
            <BookOpen aria-hidden />
            Return policy
          </Badge>
          <Badge variant="success" size="sm" className="gap-1">
            <BarChart3 aria-hidden />
            High confidence
          </Badge>
        </div>
      </div>
    </div>
  );
}
