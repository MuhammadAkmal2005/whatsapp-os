import type { Metadata } from 'next';
import { Info } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { APP_NAME } from '@/config/constants';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms under which you may use ${APP_NAME}.`,
};

const LAST_UPDATED = 'August 2026';

export default function TermsPage() {
  return (
    <article className="container max-w-3xl py-16 lg:py-24">
      <header className="flex flex-col gap-2 border-b border-border pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </header>

      <div className="mt-8 flex flex-col gap-8 text-sm leading-relaxed text-foreground">
        {/* Same information banner as the privacy page, so the two legal pages open
            identically and the notice reads as something to act on. */}
        <Alert variant="info">
          <Info aria-hidden />
          <AlertTitle>This is a template, not legal advice</AlertTitle>
          <AlertDescription>
            These terms ship with {APP_NAME} as a starting point. Review and adapt them to your
            business and local law before you go live.
          </AlertDescription>
        </Alert>

        <Section title="Acceptance">
          By creating an account or using {APP_NAME}, you agree to these terms on behalf of your
          business. If you do not agree, do not use the service.
        </Section>

        <Section title="Your account">
          You are responsible for the accuracy of your account details, for keeping your credentials
          safe, and for the activity of the team members you invite. Tell us promptly if you believe
          an account has been compromised.
        </Section>

        <Section title="Acceptable use">
          You may use {APP_NAME} only for lawful business messaging with people who expect to hear
          from you. You must not use it to send spam or unsolicited bulk messages, to harass or
          deceive, to break the WhatsApp Business Platform terms or Meta&apos;s policies, or to
          attempt to access another workspace&apos;s data. Messaging must respect WhatsApp&apos;s
          messaging windows and honour opt-outs.
        </Section>

        <Section title="WhatsApp and third-party services">
          {APP_NAME} connects to the official WhatsApp Business Platform and other third-party
          providers. Your use of those services is also governed by their terms, and their
          availability is outside our control. We are not affiliated with or endorsed by Meta.
        </Section>

        <Section title="AI-generated content">
          Your AI employee produces replies automatically from the data and instructions you provide.
          It is designed to answer only from that data and to hand off when it cannot, but you remain
          responsible for the messages sent from your number. Review your configuration and test the
          AI before going live, and keep a human in the loop for sensitive matters.
        </Section>

        <Section title="Plans, trials and billing">
          Paid plans and their limits are described on the pricing page. Paid plans include a trial
          period; unless you subscribe, a workspace moves to the free plan when the trial ends. When
          you exceed a plan limit we restrict the affected action and warn you in advance — we do not
          delete your data because of a limit.
        </Section>

        <Section title="Your data">
          You keep ownership of your workspace and customer data. How it is handled is described in
          the Privacy Policy. You are responsible for having the right to process the customer data
          you bring into the platform.
        </Section>

        <Section title="Availability and changes">
          We work to keep the service available and may update features over time. We may change these
          terms; when we do, we will update the date above and, for material changes, give reasonable
          notice.
        </Section>

        <Section title="Liability">
          The service is provided on a commercially reasonable basis. To the extent permitted by law,
          {' '}{APP_NAME} is not liable for indirect or consequential losses, or for losses arising
          from your misuse of the service or from third-party providers.
        </Section>

        <Section title="Termination">
          You may close your account at any time. We may suspend or end access for a serious or
          repeated breach of these terms, particularly around messaging abuse or attempts to reach
          another business&apos;s data.
        </Section>

        <Section title="Contact">
          Questions about these terms can be raised from the Settings area of your workspace once you
          are signed in.
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
