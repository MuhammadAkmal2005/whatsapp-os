'use client';

/**
 * Thin wrapper over next-themes.
 *
 * Isolated into its own client component so the root layout can stay a server
 * component — the provider needs client-side APIs, but the document shell around
 * it does not, and keeping the boundary here avoids marking the whole tree
 * client-rendered.
 */

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
