import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  MessageSquareText,
  PlugZap,
  Rocket,
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

const starterPrice = formatMoney(money(PLANS.starter.priceMinor, PLANS.starter.currency));

const FEATURES = [
  {
    icon: MessageSquareText,
    title: 'One shared inbox',
    body: 'Every WhatsApp chat in one place, with search, filters, assignment and status — so nothing gets lost in a personal phone.',
  },
  {
    icon: Sparkles,
    title: 'An AI that knows your shop',
    body: 'It answers from your real prices, stock and policies. When it does not know, it says so and hands the chat to you.',
  },
  {
    icon: ShoppingBag,
    title: 'Orders, captured',
    body: 'Collect product, size, quantity and address in chat, then create an order with totals worked out correctly, every time.',
  },
  {
    icon: Users,
    title: 'A customer record that builds itself',
    body: 'Every contact, their orders, spend and history — kept up to date from the conversations you are already having.',
  },
  {
    icon: BookOpen,
    title: 'Teach it once',
    body: 'Add your FAQs, delivery and return policies. Your assistant uses them to answer accurately instead of guessing.',
  },
  {
    icon: Workflow,
    title: 'Follow-ups on autopilot',
    body: 'Nudge an abandoned cart, ask for a review after delivery, remind about an appointment — without remembering to.',
  },
];

const STEPS = [
  {
    icon: PlugZap,
    title: 'Connect WhatsApp',
    body: 'Link your official WhatsApp Business number. Messages start arriving in your dashboard right away.',
  },
  {
    icon: BookOpen,
    title: 'Teach your AI',
    body: 'Add your products, prices and a few FAQs. Test it in a playground until it sounds like your shop.',
  },
  {
    icon: Rocket,
    title: 'Go live',
    body: 'Let the AI handle the routine questions and orders. Step in whenever you want — you are always in control.',
  },
];

const FAQS = [
  {
    q: 'Is this official WhatsApp, or a workaround?',
    a: 'Official. WhatsApp OS connects through the WhatsApp Business Platform (Cloud API). There is no QR-code hack or web scraping, so your number stays safe and compliant.',
  },
  {
    q: 'Will the AI make up prices or stock?',
    a: 'No. It only states prices, stock, delivery times and policies that come from your own data. If it does not have the answer, it tells the customer and hands the chat to your team.',
  },
  {
    q: 'Does it understand Urdu and Roman Urdu?',
    a: 'Yes. It handles English, Urdu and Roman Urdu — including mixed messages like “bhai black wala XL available hai?” — and replies naturally in the same style.',
  },
  {
    q: 'Can I take over a conversation myself?',
    a: 'Any time. Pause the AI on a single chat, reply yourself, and switch it back on when you are done. Sensitive or angry conversations are handed to you automatically.',
  },
  {
    q: 'What kind of business is this for?',
    a: 'It is built first for online clothing and e-commerce sellers in Pakistan, but works for any business that sells and supports customers over WhatsApp.',
  },
];

export default function LandingPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-gradient-to-b from-primary/5 to-transparent" />
        <div className="container grid gap-12 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
          <div className="flex flex-col items-start gap-6">
            <Badge variant="default" className="gap-1.5">
              <Sparkles className="size-3.5" aria-hidden />
              Your AI employee for WhatsApp
            </Badge>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Turn WhatsApp into your{' '}
              <span className="text-primary">AI-powered business OS</span>
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Automatically answer customers, capture leads, manage orders and grow sales — directly
              from WhatsApp, in English, Urdu and Roman Urdu.
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
              Free to start · No card required · Set up in minutes
            </p>
          </div>

          <ConversationMock />
        </div>
      </section>

      {/* ── Value strip ──────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-muted/30">
        <div className="container grid gap-6 py-8 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, label: 'Official WhatsApp Business Platform' },
            { icon: MessageSquareText, label: 'English, Urdu & Roman Urdu' },
            { icon: Clock, label: 'Replies in seconds, day and night' },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-center gap-2.5 text-center">
              <item.icon className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Problem ──────────────────────────────────────────────────────── */}
      <section className="container py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Sound familiar?</h2>
          <p className="mt-4 text-muted-foreground">
            You are the sales team, the support team and the order desk — replying to the same
            questions all day while real orders slip through at night.
          </p>
        </div>
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
          {[
            '“Price kya hai?” — answered for the hundredth time today.',
            'A customer sends a payment screenshot at 2am. Nobody replies until morning.',
            'You forget to follow up, and the sale goes cold.',
            'Orders live in chat scrollback, not in one place you can trust.',
          ].map((pain) => (
            <div
              key={pain}
              className="rounded-lg border border-border bg-card p-5 text-sm text-card-foreground"
            >
              {pain}
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" className="border-y border-border bg-muted/30 py-20">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Live in three steps</h2>
            <p className="mt-4 text-muted-foreground">
              No technical setup. If you can use WhatsApp, you can set this up.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title} className="relative rounded-xl border border-border bg-card p-6">
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <step.icon className="size-5" aria-hidden />
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-sm font-semibold text-primary">Step {index + 1}</span>
                </div>
                <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="container py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Everything your WhatsApp operation needs
          </h2>
          <p className="mt-4 text-muted-foreground">
            Not just a chatbot. A place to run sales, support and orders — with AI doing the
            repetitive part.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-border bg-card p-6">
              <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="size-5" aria-hidden />
              </div>
              <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── AI employee highlight ────────────────────────────────────────── */}
      <section className="border-y border-border bg-muted/30 py-20">
        <div className="container grid gap-12 lg:grid-cols-2 lg:items-center">
          <div className="flex flex-col items-start gap-5">
            <Badge variant="default" className="gap-1.5">
              <Sparkles className="size-3.5" aria-hidden />
              Meet your AI employee
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight">
              It works your hours — and the ones you cannot
            </h2>
            <p className="text-muted-foreground">
              Give your assistant a name, a tone and the languages your customers use. It greets
              buyers, answers from your catalogue, qualifies leads and starts orders — then hands
              the tricky ones to you with the full context.
            </p>
            <ul className="flex flex-col gap-3">
              {[
                'Grounded in your prices, stock and policies — never invented',
                'Knows when to escalate: refunds, complaints, anything sensitive',
                'You see exactly what it used to answer, before you go live',
              ].map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{point}</span>
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

          <PlaygroundMock />
        </div>
      </section>

      {/* ── Pricing teaser ───────────────────────────────────────────────── */}
      <section className="container py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Simple, honest pricing</h2>
          <p className="mt-4 text-muted-foreground">
            Start free. Upgrade when your shop is busy enough to need it. Plans from{' '}
            <span className="font-medium text-foreground">{starterPrice}/month</span>.
          </p>
          <div className="mt-8">
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">
                See all plans
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="border-t border-border bg-muted/30 py-20">
        <div className="container mx-auto max-w-3xl">
          <h2 className="text-center text-3xl font-semibold tracking-tight">
            Questions, answered
          </h2>
          <div className="mt-10 flex flex-col gap-3">
            {FAQS.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-lg border border-border bg-card p-5 [&_summary]:cursor-pointer"
              >
                <summary className="flex items-center justify-between gap-4 text-left font-medium marker:content-none">
                  {faq.q}
                  <ArrowRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                    aria-hidden
                  />
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="bg-sidebar py-20 text-sidebar-foreground">
        <div className="container mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-white">
            Ready to let AI handle the messages?
          </h2>
          <p className="mt-4 text-sidebar-foreground">
            Connect your WhatsApp, teach your AI, and watch orders arrive while you focus on the
            business.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
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
              className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

/** A styled WhatsApp thread showing a real Roman-Urdu exchange and an order card.
 *  Static markup — it illustrates the product without claiming to be live. */
function ConversationMock() {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-lg">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          AF
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Akmal Fashion</p>
          <p className="text-2xs text-success">● online · replies instantly</p>
        </div>
        <Badge variant="success" className="ml-auto gap-1">
          <Sparkles className="size-3" aria-hidden />
          AI
        </Badge>
      </div>

      <div className="flex flex-col gap-2.5 py-4">
        <Bubble side="in">AOA, black kurta XL available hai?</Bubble>
        <Bubble side="out">
          Jee bilkul! Black kurta XL available hai. Price <strong>Rs. 3,499</strong> hai aur COD bhi
          available hai. Kitne chahiye? 😊
        </Bubble>
        <Bubble side="in">2 chahiye. Karachi deliver ho jayega?</Bubble>
        <Bubble side="out">
          Jee, Karachi 2–3 din mein. Address bhej dein, main order bana deta hoon.
        </Bubble>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>Order draft</span>
          <span>COD</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span>Black Kurta (XL) × 2</span>
          <span className="tabular-nums">Rs. 6,998</span>
        </div>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Delivery</span>
          <span className="tabular-nums">Rs. 250</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
          <span>Total</span>
          <span className="tabular-nums">Rs. 7,248</span>
        </div>
      </div>
    </div>
  );
}

/** A compact AI-playground preview: the message, the answer, and the evidence
 *  the answer was built from — the product's core honesty guarantee, shown. */
function PlaygroundMock() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-lg">
      <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-medium">
        <Sparkles className="size-4 text-primary" aria-hidden />
        AI test playground
      </div>
      <div className="flex flex-col gap-3 pt-4">
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Customer</span>
          <p className="mt-1">What is your return policy for stitched clothes?</p>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
          <span className="text-xs font-medium text-primary">Assistant</span>
          <p className="mt-1">
            Stitched items can be exchanged within 7 days if unworn, with the receipt. Refunds are
            store credit. Would you like the address to send it back?
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-2xs">
          <Badge variant="muted" className="gap-1">
            <BookOpen className="size-3" aria-hidden />
            From: Return policy
          </Badge>
          <Badge variant="success" className="gap-1">
            <BarChart3 className="size-3" aria-hidden />
            High confidence
          </Badge>
        </div>
      </div>
    </div>
  );
}

function Bubble({ side, children }: { side: 'in' | 'out'; children: React.ReactNode }) {
  const isOut = side === 'out';
  return (
    <div className={isOut ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isOut
            ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground'
            : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground'
        }
      >
        {children}
      </div>
    </div>
  );
}
