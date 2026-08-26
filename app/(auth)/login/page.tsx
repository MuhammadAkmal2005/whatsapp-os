import type { Metadata } from 'next';
import Link from 'next/link';

import { LoginForm } from '@/components/auth/login-form';
import { firstParam } from '@/lib/search-params';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const inviteToken = firstParam((await searchParams).invite);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          {inviteToken
            ? 'Sign in to accept your invitation and join the business.'
            : 'Sign in to manage your conversations, orders and AI assistant.'}
        </p>
      </div>

      <LoginForm inviteToken={inviteToken} />

      <p className="text-sm text-muted-foreground">
        New here?{' '}
        <Link
          href={inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : '/signup'}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
