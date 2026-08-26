import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const metadata: Metadata = {
  title: 'Reset your password',
};

/**
 * Password reset is delivered by email, which is connected per-deployment. Until
 * an email provider is configured this page does not pretend to send anything —
 * the brief is firm that a control either works or is honestly unavailable. It
 * explains the real recovery path (an owner or admin can help) and links back to
 * sign in. When the email provider lands, this becomes the request form.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll help you get back into your account.
        </p>
      </div>

      <Alert variant="info">
        <Mail aria-hidden />
        <AlertTitle>Email reset isn&apos;t switched on yet</AlertTitle>
        <AlertDescription>
          Self-service reset by email becomes available once your workspace connects an email
          sender. In the meantime, an Owner or Admin on your team can reset access for you from
          Settings → Team.
        </AlertDescription>
      </Alert>

      <Link
        href="/login"
        className="inline-flex items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to sign in
      </Link>
    </div>
  );
}
