import type { Metadata, Viewport } from 'next';

import { ThemeProvider } from '@/components/theme-provider';
import { APP_NAME, APP_TAGLINE } from '@/config/constants';

import './globals.css';

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1f19' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required and expected: next-themes sets the
    // theme class on <html> before React hydrates, so the server and client
    // markup differ by design on this one attribute.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
