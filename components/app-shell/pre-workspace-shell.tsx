import Link from 'next/link';

import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/config/constants';
import { logoutAction } from '@/server/actions/auth.actions';

/**
 * Chrome for the two screens a signed-in person sees before they are inside a
 * workspace: creating their first business, and picking between businesses. A
 * light top bar (logo, theme, sign out) and a centred column — no sidebar,
 * because there is no workspace to navigate yet.
 *
 * Sign out is a real server action wired straight to a form, so it works
 * without a client component: the session is revoked server-side, not just
 * forgotten in the browser.
 */
export function PreWorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/" aria-label={`${APP_NAME} home`} className="inline-flex">
            <Logo />
          </Link>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-form">{children}</div>
      </main>
    </div>
  );
}
