import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { MarketingHeader } from '@/components/marketing/marketing-header';
import { APP_NAME } from '@/config/constants';

/**
 * The public site's frame.
 *
 * Two things here are load-bearing for everything inside it. `marketing` declares the
 * atmosphere tokens for this subtree, so the decorative lighting inverts with the theme and
 * the shared `Button`, `Badge` and `Card` primitives keep reading the same brand ramp the
 * product does — without a single authenticated-app file changing. `mk-js` is what arms the
 * scroll reveals: the rules that hide an unrevealed element are all written under `.mk-js`,
 * so the `<noscript>` override below is enough to guarantee that a reader without JavaScript
 * sees the whole page rather than a blank one.
 *
 * The footer takes the contrast band like the closing call to action above it, so the page
 * changes ground once and holds it to the bottom instead of flashing back for a list of links.
 */

const FOOTER_SECTIONS = [
  {
    heading: 'Product',
    links: [
      { label: 'How it works', href: '/#how' },
      { label: 'Features', href: '/#features' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Questions', href: '/#faq' },
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
    <div className="marketing mk-js flex min-h-dvh flex-col overflow-x-clip">
      {/* Unlayered, so it beats the layered rules in globals.css whatever their order. */}
      <noscript>
        <style>{`.mk-reveal{opacity:1!important;transform:none!important;filter:none!important}`}</style>
      </noscript>

      <MarketingHeader />

      <main className="flex-1 overflow-x-clip">{children}</main>

      <footer className="marketing-band border-t border-border">
        <div className="container grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
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
                      className="rounded-xs text-sm text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
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
          <div className="container flex flex-col gap-3 py-6 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()} {APP_NAME}. Built for businesses that run on WhatsApp.
            </p>
            {/* Stated plainly because the product is named after someone else's platform, and a
                reader deciding whether this is official deserves the answer without hunting. */}
            <p className="sm:text-right">
              An independent product, not affiliated with Meta. WhatsApp is a trademark of Meta
              Platforms, Inc.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
