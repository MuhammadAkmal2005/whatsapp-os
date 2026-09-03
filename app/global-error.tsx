'use client';

import { useEffect } from 'react';

/**
 * The last-resort boundary. A normal `error.tsx` renders *inside* the root layout, so it
 * cannot catch a failure in the layout itself. This one replaces the whole document, which
 * is why it renders its own `<html>`/`<body>` and ships its own styles — when this shows,
 * the assumption that anything else loaded correctly no longer holds. It only runs in
 * production; in development Next.js shows its error overlay instead.
 *
 * This is the one file in the product allowed to write literal colour values, and it has to.
 * The design tokens live in the app stylesheet, and the whole premise of this screen is that
 * the stylesheet may be exactly what failed. So the values below are transcribed from
 * `app/globals.css` — a stale copy in one unreachable file is the acceptable cost of a
 * readable error page; reaching for `hsl(var(--background))` here would risk a black-on-black
 * screen at the worst possible moment.
 *
 * For the same reason the theme follows `prefers-color-scheme` rather than the `dark` class:
 * the script that sets that class is part of the app that just failed. A reader on a dark
 * system therefore gets a dark error page, which is the right answer even when it disagrees
 * with a light override they had chosen.
 */

/* Transcribed from app/globals.css. Keep in step with --background, --foreground,
   --muted-foreground, --border, --primary and --primary-foreground if those change. */
const STYLES = `
  :root {
    color-scheme: light;
    --e-bg: #f3f6f5;
    --e-fg: #13201e;
    --e-muted: #617570;
    --e-border: #dae1de;
    --e-accent: #167446;
    --e-accent-fg: #f8fcfa;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --e-bg: #0e1615;
      --e-fg: #e9edeb;
      --e-muted: #91a19a;
      --e-border: #273432;
      --e-accent: #3da47e;
      --e-accent-fg: #0a1513;
    }
  }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1.5rem;
    text-align: center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica,
      Arial, sans-serif;
    background: var(--e-bg);
    color: var(--e-fg);
  }
  .e-title { margin: 0; font-size: 1.375rem; font-weight: 600; letter-spacing: -0.01em; }
  .e-body { margin: 0; max-width: 28rem; font-size: 0.875rem; line-height: 1.5; color: var(--e-muted); }
  .e-ref {
    margin: 0;
    font-size: 0.75rem;
    color: var(--e-muted);
    border-top: 1px solid var(--e-border);
    padding-top: 0.75rem;
  }
  .e-ref code { font-family: ui-monospace, SFMono-Regular, monospace; }
  .e-action {
    margin-top: 0.25rem;
    height: 2.25rem;
    padding: 0 1.125rem;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    background: var(--e-accent);
    color: var(--e-accent-fg);
  }
  .e-action:focus-visible { outline: 2px solid var(--e-accent); outline-offset: 2px; }
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>
        <h1 className="e-title">Something went wrong</h1>
        <p className="e-body">
          An unexpected error stopped the app from loading. Please try again — if it keeps
          happening, get in touch with our team.
        </p>
        {error.digest ? (
          <p className="e-ref">
            Reference: <code>{error.digest}</code>
          </p>
        ) : null}
        <button type="button" onClick={reset} className="e-action">
          Try again
        </button>
      </body>
    </html>
  );
}
