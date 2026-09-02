import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { APP_NAME } from '@/config/constants';

/**
 * Two-pane auth shell. The form sits on the left at a comfortable reading width;
 * a brand panel fills the right on large screens with the one-line promise and a
 * few concrete proof points. On mobile the panel drops away and the form takes
 * the full width — an auth screen on a phone should be nothing but the task.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <header>
          <Link href="/" aria-label={`${APP_NAME} home`} className="inline-flex">
            <Logo />
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        <footer className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} {APP_NAME}
        </footer>
      </div>

      <aside
        aria-labelledby="auth-panel-heading"
        className="hidden bg-sidebar px-12 py-16 text-sidebar-foreground lg:flex lg:flex-col lg:justify-center"
      >
        <div className="max-w-form">
          <h2
            id="auth-panel-heading"
            className="text-2xl font-semibold leading-snug text-sidebar-strong"
          >
            Your AI-powered sales and support team on WhatsApp.
          </h2>
          <p className="mt-4">
            Answer customers instantly, capture every lead, and turn chats into orders — all from
            one dashboard, in the language your customers actually write in.
          </p>
          <ul className="mt-10 flex flex-col gap-4 text-sm">
            {[
              'Replies grounded in your real prices and stock — never guessed.',
              'Every conversation, contact and order in one place.',
              'Step in and take over any chat the moment you want to.',
            ].map((point) => (
              <li key={point} className="flex items-start gap-3">
                {/* --sidebar-primary, not --primary: this panel is ink in both themes and the
                    paper-tuned moss disappears against it. */}
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sidebar-primary"
                  aria-hidden
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
