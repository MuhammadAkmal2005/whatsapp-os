import type { Metadata } from 'next';
import Link from 'next/link';

import { SignupForm } from '@/components/auth/signup-form';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = {
  title: 'Create your account',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const inviteToken = firstParam((await searchParams).invite);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {inviteToken ? 'Create your account to join' : 'Start free'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {inviteToken
            ? 'Set up your own sign-in, then you will be taken straight to the invitation.'
            : 'Create your account, then set up your business in a few minutes. No card required.'}
        </p>
      </div>

      <SignupForm inviteToken={inviteToken} />

      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : '/login'}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>

      <p className="text-xs text-muted-foreground">
        By creating an account you agree to our{' '}
        <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
