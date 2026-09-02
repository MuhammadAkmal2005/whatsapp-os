import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/config/constants';

const NAV_LINKS = [
  { label: 'Features', href: '/#features' },
  { label: 'How it works', href: '/#how' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '/#faq' },
];

const FOOTER_SECTIONS = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '/#features' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'How it works', href: '/#how' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
  {
    heading: 'Get started',
    links: [
      { label: 'Create account', href: '/signup' },
      { label: 'Sign in', href: '/login' },
    ],
  },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Solid rather than translucent-and-blurred: the same treatment the product's own
          mobile header uses, and one less thing between the reader and the words. */}
      <header className="sticky top-0 z-40 border-b border-border bg-background shadow-sticky">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/" aria-label={`${APP_NAME} home`} className="inline-flex">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-surface-sunken">
        <div className="container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-3">
            <Logo />
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              The WhatsApp inbox, AI assistant, customer records and order book that small shops
              actually run on.
            </p>
          </div>
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.heading} className="flex flex-col gap-3">
              <h2 className="eyebrow">{section.heading}</h2>
              <ul className="flex flex-col gap-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-border">
          <div className="container flex flex-col items-center justify-between gap-2 py-6 text-xs text-muted-foreground sm:flex-row">
            <p>
              © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
            </p>
            <p>Built for Pakistani businesses that run on WhatsApp.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
