import type { Metadata } from 'next';
import { Info } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { APP_NAME } from '@/config/constants';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${APP_NAME} handles personal and customer data.`,
};

const LAST_UPDATED = 'August 2026';

export default function PrivacyPage() {
  return (
    <article className="container max-w-3xl py-16 lg:py-24">
      <header className="flex flex-col gap-2 border-b border-border pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </header>

      <div className="mt-8 flex flex-col gap-8 text-sm leading-relaxed text-foreground">
        {/* Flagged as a template in the product's own information banner rather than as a grey
            box, so it reads as a notice to act on and not as an introduction to skim. */}
        <Alert variant="info">
          <Info aria-hidden />
          <AlertTitle>This is a template, not legal advice</AlertTitle>
          <AlertDescription>
            This policy ships with {APP_NAME} as a starting point. Before you go live with real
            customers, have it reviewed against your obligations and local law.
          </AlertDescription>
        </Alert>

        <Section title="Who we are">
          {APP_NAME} is a platform that lets a business connect its official WhatsApp Business
          number and manage customer conversations, contacts, orders and related records from one
          dashboard. This policy explains what data the platform holds and how it is used.
        </Section>

        <Section title="The two kinds of data here">
          There are two distinct roles. For your <strong>account and billing information</strong> —
          your name, email, workspace and subscription — the platform is the data controller. For
          the <strong>customer data inside your workspace</strong> — the people who message your
          WhatsApp, their messages, contact details and orders — your business is the controller and
          the platform processes that data on your behalf, under your instructions.
        </Section>

        <Section title="What we collect">
          Account data you provide when signing up: name, email address and password (stored only as
          a secure hash). Workspace data you create: business profile, products, prices, policies and
          team members. Customer data that flows in through WhatsApp: phone numbers, message content,
          media, and any order or contact details captured in a conversation. Usage and diagnostic
          data: which features are used, AI usage counts, and error logs tied to a request identifier
          for troubleshooting.
        </Section>

        <Section title="How the data is used">
          To operate the service you asked for: delivering messages, letting your AI answer from your
          own data, creating orders, and showing analytics. To keep the service secure and reliable.
          To meter usage against your plan. We do not sell personal data, and we do not use the
          contents of one workspace to benefit another.
        </Section>

        <Section title="AI processing">
          When your AI employee generates a reply, the relevant message, retrieved knowledge and
          business context are sent to an AI provider to produce that response. The AI is grounded in
          your own data and is instructed not to state facts it was not given. Usage is recorded so
          you can see what was consumed.
        </Section>

        <Section title="Sharing with providers">
          The platform relies on a small number of infrastructure providers — for the WhatsApp
          Business Platform, AI generation, database hosting, file storage and payments. Each receives
          only the data needed to perform its function, and only to provide the service to you.
        </Section>

        <Section title="Retention">
          Workspace and customer data is kept for as long as your workspace is active. When you delete
          a record or close your account, the associated data is removed within a reasonable period,
          except where a limited retention is required to meet a legal or accounting obligation.
        </Section>

        <Section title="Your controls">
          You can view, edit and delete the customer records in your workspace, export your data, and
          close your account. Because your business is the controller for customer data, requests from
          your own customers should reach you first; the platform will support you in fulfilling them.
        </Section>

        <Section title="Security">
          Access to data is scoped to its workspace and enforced on the server. Secrets are held
          server-side and never exposed to the browser. Sensitive actions are recorded, so there is
          a history of who changed what. No system is perfectly secure, but security is treated as a
          core part of the product, not an afterthought.
        </Section>

        <Section title="Contact">
          Questions about this policy or your data can be raised from the Settings area of your
          workspace once you are signed in.
        </Section>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground">{children}</p>
    </section>
  );
}
