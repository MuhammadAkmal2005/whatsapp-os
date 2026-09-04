import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Schibsted_Grotesk } from 'next/font/google';

import { ThemeProvider } from '@/components/theme-provider';
import { APP_NAME, APP_TAGLINE } from '@/config/constants';

import './globals.css';

/**
 * The interface face. A Nordic grotesque with tight sidebearings and squared bowls: it
 * stays legible at the eleven-pixel labels this product is mostly made of, and gains
 * real character at heading sizes, which is not true of the neutral geometric sans that
 * every dashboard reaches for.
 *
 * Loaded as a variable font so weight 400 through 700 costs one file, and self-hosted by
 * next/font — no request leaves the user's browser for a font, which is why the
 * Content-Security-Policy needs no third-party font origin.
 */
const sans = Schibsted_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  // Metric-adjacent system fallbacks, so the pre-swap paint is close in size and the
  // layout does not jump when the real face arrives.
  fallback: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
});

/**
 * The data face, used for one reason rather than for texture: money, quantities, phone
 * numbers, order references and identifiers only line up in a column when the digits
 * share a width. An order book whose totals do not align is measurably harder to scan.
 */
const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
});

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    'Connect your WhatsApp Business number and let AI answer customers, capture leads, and create orders — all managed from one dashboard.',
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  // Matches --background in each theme, so the browser chrome on mobile continues the
  // page instead of framing it in white.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f0f5f4' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1615' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required and expected: next-themes sets the
    // theme class on <html> before React hydrates, so the server and client
    // markup differ by design on this one attribute.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-base antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
