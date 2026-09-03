'use client';

import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/config/constants';
import { cn } from '@/lib/utils';

/**
 * The public header.
 *
 * It is ink in both themes, like the product's own sidebar, which is what lets it sit flush
 * against the ink hero with no seam at the top of the page and then read as a floating bar
 * once light sections have scrolled under it. The change on scroll is a hairline and a shadow
 * rather than a background swap — the same trick, one less thing to get wrong, and no
 * translucency to make the wordmark hard to read over a moving product mockup.
 *
 * The mobile panel overlays rather than pushes: an absolutely positioned panel animates
 * transform and opacity, which the compositor handles, and needs no measured height. Animating
 * a real height would mean either a magic `max-height` that clips the day someone adds a link,
 * or a resize observer for a menu with six rows in it.
 */

const NAV_LINKS = [
  { label: 'How it works', href: '/#how' },
  { label: 'Features', href: '/#features' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '/#faq' },
];

export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeMenu = useCallback(
    (returnFocus: boolean) => {
      setMenuOpen(false);
      if (returnFocus) toggleRef.current?.focus();
    },
    [],
  );

  // Escape closes from anywhere inside the panel, and focus goes back to the button that
  // opened it rather than to the top of the document.
  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen, closeMenu]);

  return (
    <header
      className={cn(
        'marketing-ink sticky top-0 z-40 transition-shadow duration-moderate ease-out',
        scrolled ? 'shadow-sticky' : 'shadow-none',
      )}
    >
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label={`${APP_NAME} home`} className="inline-flex rounded-md">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="mk-nav-link text-sm text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
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
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/signup">Start free</Link>
          </Button>

          <button
            ref={toggleRef}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="marketing-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex size-control items-center justify-center rounded-md text-foreground transition-colors duration-fast ease-out hover:bg-accent md:hidden"
          >
            {/* Both icons are mounted and cross-faded, so the change is a rotation rather
                than a swap — and there is no reflow when the glyph changes. */}
            <span className="relative flex size-4 items-center justify-center" aria-hidden>
              <Menu
                className={cn(
                  'absolute size-4 transition-all duration-fast ease-out',
                  menuOpen ? 'rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100',
                )}
              />
              <X
                className={cn(
                  'absolute size-4 transition-all duration-fast ease-out',
                  menuOpen ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-75 opacity-0',
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {/* The hairline is its own element so it can fade independently of the bar, which keeps
          the top of the page seamless against the hero. */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-x-0 bottom-0 h-px bg-border transition-opacity duration-moderate ease-out',
          scrolled || menuOpen ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div
        id="marketing-menu"
        data-open={menuOpen}
        className="mk-menu-panel absolute inset-x-0 top-full border-b border-border bg-background shadow-overlay md:hidden"
      >
        <nav className="container flex flex-col py-3" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => closeMenu(false)}
              className="rounded-md py-2.5 text-sm text-foreground transition-colors duration-fast ease-out hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:hidden">
            <Button asChild variant="outline">
              <Link href="/login" onClick={() => closeMenu(false)}>
                Sign in
              </Link>
            </Button>
            <Button asChild>
              <Link href="/signup" onClick={() => closeMenu(false)}>
                Start free
              </Link>
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
